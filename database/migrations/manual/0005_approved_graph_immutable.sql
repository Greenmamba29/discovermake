-- Stage 1 hardening: approved Build Graph versions are immutable in the database itself
-- (ADR-0001 copy-on-write). Applied by migrateDatabase() after the drizzle migrations, on
-- every run: idempotent (CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS).
--
-- Rules (a version is "frozen" once it is APPROVED, and stays frozen when SUPERSEDED):
--   bg_nodes / bg_edges   no INSERT, UPDATE or DELETE of a row whose (build_id, design_version)
--                         is a frozen version (nor moving a row into one);
--   design_versions       APPROVED may only become SUPERSEDED, with every other column unchanged;
--                         SUPERSEDED never changes; frozen versions cannot be deleted.
-- Exception: deleting the whole build (ON DELETE CASCADE from builds) is allowed: by the time
-- the cascade reaches these rows the builds row is gone.
-- Violations raise SQLSTATE 'DM001' (message starts with "immutable:").

CREATE OR REPLACE FUNCTION dm_version_frozen(p_build_id text, p_version integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM design_versions
        WHERE build_id = p_build_id AND version = p_version AND status <> 'DRAFT'
    )
$$;

CREATE OR REPLACE FUNCTION dm_bg_rows_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM builds WHERE id = OLD.build_id) THEN
            RETURN OLD; -- the whole build is being deleted
        END IF;
        IF dm_version_frozen(OLD.build_id, OLD.design_version) THEN
            RAISE EXCEPTION 'immutable: % rows of approved design version % of build % cannot be deleted', TG_TABLE_NAME, OLD.design_version, OLD.build_id
                USING ERRCODE = 'DM001';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND dm_version_frozen(OLD.build_id, OLD.design_version) THEN
        RAISE EXCEPTION 'immutable: % rows of approved design version % of build % cannot be changed', TG_TABLE_NAME, OLD.design_version, OLD.build_id
            USING ERRCODE = 'DM001';
    END IF;
    IF dm_version_frozen(NEW.build_id, NEW.design_version) THEN
        RAISE EXCEPTION 'immutable: approved design version % of build % cannot gain % rows', NEW.design_version, NEW.build_id, TG_TABLE_NAME
            USING ERRCODE = 'DM001';
    END IF;
    RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION dm_design_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'DRAFT' AND EXISTS (SELECT 1 FROM builds WHERE id = OLD.build_id) THEN
            RAISE EXCEPTION 'immutable: % design version % of build % cannot be deleted', OLD.status, OLD.version, OLD.build_id
                USING ERRCODE = 'DM001';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'DRAFT' THEN
        RETURN NEW;
    END IF;
    -- Frozen: only APPROVED -> SUPERSEDED, and nothing but the status may change.
    IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
        RAISE EXCEPTION 'immutable: the content of % design version % of build % cannot be edited', OLD.status, OLD.version, OLD.build_id
            USING ERRCODE = 'DM001';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'APPROVED' AND NEW.status = 'SUPERSEDED') THEN
        RAISE EXCEPTION 'immutable: design version % of build % cannot go from % to %', OLD.version, OLD.build_id, OLD.status, NEW.status
            USING ERRCODE = 'DM001';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS bg_nodes_immutable ON bg_nodes;
CREATE TRIGGER bg_nodes_immutable BEFORE INSERT OR UPDATE OR DELETE ON bg_nodes
    FOR EACH ROW EXECUTE FUNCTION dm_bg_rows_immutable();

DROP TRIGGER IF EXISTS bg_edges_immutable ON bg_edges;
CREATE TRIGGER bg_edges_immutable BEFORE INSERT OR UPDATE OR DELETE ON bg_edges
    FOR EACH ROW EXECUTE FUNCTION dm_bg_rows_immutable();

DROP TRIGGER IF EXISTS design_versions_immutable ON design_versions;
CREATE TRIGGER design_versions_immutable BEFORE UPDATE OR DELETE ON design_versions
    FOR EACH ROW EXECUTE FUNCTION dm_design_version_immutable();
