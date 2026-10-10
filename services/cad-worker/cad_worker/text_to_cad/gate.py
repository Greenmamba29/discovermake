"""Static gate for Make AI model scripts. Runs BEFORE anything executes.

A script passes only when it is a plain cadgen model in the shape the Make AI preamble asks for:

    from __future__ import annotations      # optional
    import math                             # optional; `typing` too
    from cadgen import build123d as bd
    from cadgen import step, glb, stl       # any subset

    WIDTH = 40.0                            # constants and helper functions are fine

    @step(out="model.step")
    @glb(out="model.glb")
    @stl(out="model.stl")
    def model():
        return bd.Box(WIDTH, 20, 6)

    if __name__ == "__main__":
        model()

Rejected (each with its line): any other import; the builtins that reach code, files, frames or
attributes by name (open, exec, eval, compile, __import__, globals, locals, vars, getattr, setattr,
delattr, hasattr, input, breakpoint, help, dir, exit, quit, memoryview); every name and attribute
starting with an underscore (a lone `_` throwaway is allowed; `__name__` only in the main guard;
`__future__` only in its import); frame / generator / code attributes (gi_frame, f_globals, ...);
str.format (it reads attributes by name); build123d file, font and export functions and any
`import_*` / `export_*` / `font_path`; class definitions, async code and `global`; decorators other
than step / glb / stl (each once, with `out=` a bare filename of the right extension and only
numeric mesh tolerances besides); anything but exactly one decorated, parameterless model function
and the `if __name__ == "__main__": <model>()` guard; module-level statements other than imports,
constant assignments, function definitions, the guard and a docstring. Scripts larger than the
contract's cap are rejected unread.

This is the first of two layers: whatever passes still runs only inside the sandbox (runner.py).
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field

from .bd_names import ALLOWED_BD_NAMES

#: TEXT_TO_CAD_MAX_SCRIPT_BYTES in src/contracts/text-to-cad.ts.
MAX_SCRIPT_BYTES = 64 * 1024

OUTPUT_KINDS = ("step", "glb", "stl")
_EXTENSIONS = {"step": (".step", ".stp"), "glb": (".glb",), "stl": (".stl",)}
_DECORATOR_KEYWORDS = {"out", "mesh_tolerance", "mesh_angular_tolerance"}
_BARE_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")

ALLOWED_MODULES = {"math", "typing"}
ALLOWED_CADGEN_NAMES = {"step", "glb", "stl", "build123d"}

FORBIDDEN_BUILTINS = frozenset(
    {
        "open", "exec", "eval", "compile", "__import__", "globals", "locals", "vars", "getattr", "setattr",
        "delattr", "hasattr", "input", "breakpoint", "help", "dir", "exit", "quit", "memoryview",
    }
)

#: Attributes that read files, run code, walk frames or format attributes by name, on ANY object.
FORBIDDEN_ATTRIBUTES = frozenset(
    {
        "format", "format_map", "font_path", "make_text", "mro", "system", "popen", "environ", "getenv",
        "read", "write", "read_text", "write_text", "read_bytes", "write_bytes", "unlink", "remove", "rmtree",
        "listdir", "scandir", "walk", "glob", "save", "load", "loads", "dump", "dumps",
    }
)
_FORBIDDEN_ATTRIBUTE_PREFIXES = ("import_", "export_", "Export", "Import", "gi_", "f_", "tb_", "cr_", "ag_", "co_", "func_")


@dataclass
class GateResult:
    ok: bool
    violations: list[tuple[int, str]] = field(default_factory=list)
    #: Declared outputs, kind -> bare filename (only meaningful when ok).
    outputs: dict[str, str] = field(default_factory=dict)
    model_name: str | None = None
    #: (line, message) when the script is not valid Python. Nothing in it is unsafe yet: the
    #: runner reports it as a build failure the Make AI author can repair.
    syntax_error: tuple[int, str] | None = None


class _Checker(ast.NodeVisitor):
    def __init__(self) -> None:
        self.violations: list[tuple[int, str]] = []
        self.cadgen_aliases: dict[str, str] = {}  # local name -> cadgen name (step/glb/stl/build123d)
        self.in_main_guard_test = False

    def flag(self, node: ast.AST | None, rule: str) -> None:
        line = getattr(node, "lineno", 0) or 0
        self.violations.append((int(line), rule))

    # ---- imports ----
    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name not in ALLOWED_MODULES:
                self.flag(node, f"import of '{alias.name}' is not allowed (only math, typing and cadgen)")
            if alias.asname:
                self._name(node, alias.asname)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        if node.level:
            self.flag(node, "relative imports are not allowed")
            return
        if module == "__future__":
            for alias in node.names:
                if alias.name != "annotations":
                    self.flag(node, f"from __future__ import {alias.name} is not allowed (only annotations)")
            return
        if module == "cadgen":
            for alias in node.names:
                if alias.name not in ALLOWED_CADGEN_NAMES:
                    self.flag(node, f"from cadgen import {alias.name} is not allowed (only step, glb, stl, build123d)")
                    continue
                local = alias.asname or alias.name
                self._name(node, local)
                self.cadgen_aliases[local] = alias.name
            return
        if module in ALLOWED_MODULES:
            for alias in node.names:
                if alias.name == "*":
                    self.flag(node, f"from {module} import * is not allowed")
                self._name(node, alias.name)
                if alias.asname:
                    self._name(node, alias.asname)
            return
        self.flag(node, f"import of '{module}' is not allowed (only math, typing and cadgen)")

    # ---- names and attributes ----
    def _name(self, node: ast.AST, name: str) -> None:
        if name == "_":
            return
        if name.startswith("_"):
            self.flag(node, f"names starting with an underscore are not allowed ('{name}')")
        elif name in FORBIDDEN_BUILTINS:
            self.flag(node, f"'{name}' is not allowed")

    def visit_Name(self, node: ast.Name) -> None:
        if node.id == "__name__" and self.in_main_guard_test:
            return
        self._name(node, node.id)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        attr = node.attr
        if attr.startswith("_"):
            self.flag(node, f"attributes starting with an underscore are not allowed ('.{attr}')")
        elif attr in FORBIDDEN_ATTRIBUTES or attr.startswith(_FORBIDDEN_ATTRIBUTE_PREFIXES):
            self.flag(node, f"'.{attr}' is not allowed")
        if isinstance(node.value, ast.Name) and self.cadgen_aliases.get(node.value.id) == "build123d":
            if attr not in ALLOWED_BD_NAMES and not attr.startswith("_"):
                self.flag(node, f"build123d '{attr}' is not allowed (file, font and export functions are off)")
        if isinstance(node.value, ast.Name) and self.cadgen_aliases.get(node.value.id) in {"step", "glb", "stl"}:
            self.flag(node, f"'{node.value.id}.{attr}' is not allowed (use {node.value.id} only as a decorator)")
        self.generic_visit(node)

    def visit_keyword(self, node: ast.keyword) -> None:
        if node.arg is not None:
            if node.arg.startswith("_"):
                self.flag(node.value, f"keyword arguments starting with an underscore are not allowed ('{node.arg}')")
            elif node.arg in FORBIDDEN_ATTRIBUTES:
                self.flag(node.value, f"keyword '{node.arg}' is not allowed")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        # bd.Text(txt, size, font, font_path, ...): the fourth positional argument is a file path.
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr == "Text" and len(node.args) > 3:
            self.flag(node, "Text takes at most three positional arguments here (text, size, font name)")
        self.generic_visit(node)

    def visit_arg(self, node: ast.arg) -> None:
        self._name(node, node.arg)
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._name(node, node.name)
        # Decorators are validated in `check` (only the model function may have them).
        for child in [node.args, *node.body, *([node.returns] if node.returns else [])]:
            self.visit(child)

    def visit_Lambda(self, node: ast.Lambda) -> None:
        self.generic_visit(node)

    # ---- constructs that are off entirely ----
    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.flag(node, "class definitions are not allowed")

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.flag(node, "async functions are not allowed")

    def visit_Global(self, node: ast.Global) -> None:
        self.flag(node, "'global' is not allowed")

    def visit_Nonlocal(self, node: ast.Nonlocal) -> None:
        self.flag(node, "'nonlocal' is not allowed")

    def visit_With(self, node: ast.With) -> None:
        for item in node.items:
            ctx = item.context_expr
            if isinstance(ctx, ast.Call) and isinstance(ctx.func, ast.Name) and ctx.func.id == "open":
                self.flag(node, "'with open(...)' is not allowed (no file access)")
        self.generic_visit(node)

    def visit_Await(self, node: ast.Await) -> None:
        self.flag(node, "'await' is not allowed")

    def visit_Yield(self, node: ast.Yield) -> None:
        self.flag(node, "'yield' is not allowed")

    def visit_YieldFrom(self, node: ast.YieldFrom) -> None:
        self.flag(node, "'yield from' is not allowed")


def _is_main_guard(node: ast.stmt) -> bool:
    if not isinstance(node, ast.If) or node.orelse:
        return False
    t = node.test
    return (
        isinstance(t, ast.Compare)
        and isinstance(t.left, ast.Name)
        and t.left.id == "__name__"
        and len(t.ops) == 1
        and isinstance(t.ops[0], ast.Eq)
        and len(t.comparators) == 1
        and isinstance(t.comparators[0], ast.Constant)
        and t.comparators[0].value == "__main__"
    )


def _decorator_kind(dec: ast.expr, aliases: dict[str, str]) -> tuple[str | None, ast.Call | None]:
    call = dec if isinstance(dec, ast.Call) else None
    target = call.func if call else dec
    if isinstance(target, ast.Name) and aliases.get(target.id) in OUTPUT_KINDS:
        return aliases[target.id], call
    return None, call


def check(script: str) -> GateResult:
    """Gate one script. Pure: parses, never executes."""
    size = len(script.encode("utf-8"))
    if size > MAX_SCRIPT_BYTES:
        return GateResult(ok=False, violations=[(0, f"the script is {size} bytes; the limit is {MAX_SCRIPT_BYTES}")])
    if "\x00" in script:
        return GateResult(ok=False, violations=[(0, "the script contains a NUL byte")])
    try:
        tree = ast.parse(script, filename="model.py", mode="exec")
    except SyntaxError as e:
        return GateResult(ok=False, syntax_error=(int(e.lineno or 0), str(e.msg or "invalid syntax")[:200]))
    except (ValueError, RecursionError, MemoryError):
        return GateResult(ok=False, violations=[(0, "the script could not be read as Python")])

    checker = _Checker()
    # Imports first, so decorator aliases are known wherever the imports sit at module level.
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            checker.visit(node)

    outputs: dict[str, str] = {}
    model_fns: list[ast.FunctionDef] = []
    guards: list[ast.If] = []
    for index, node in enumerate(tree.body):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        if index == 0 and isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue  # module docstring
        if _is_main_guard(node):
            guards.append(node)  # type: ignore[arg-type]
            checker.in_main_guard_test = True
            checker.visit(node.test)  # type: ignore[attr-defined]
            checker.in_main_guard_test = False
            for stmt in node.body:  # type: ignore[attr-defined]
                checker.visit(stmt)
            continue
        if isinstance(node, ast.FunctionDef):
            if node.decorator_list:
                model_fns.append(node)
            checker.visit(node)
            continue
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            checker.visit(node)
            continue
        checker.visit(node)  # still report what is inside it
        checker.flag(node, "only imports, constants, functions and the __main__ guard may sit at the top level")

    # Nested decorators (functions inside functions) are never allowed.
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.decorator_list and node not in model_fns:
            checker.flag(node, "only the one model function may have decorators")

    if len(model_fns) != 1:
        checker.flag(model_fns[1] if len(model_fns) > 1 else None, f"exactly one decorated model function is required (found {len(model_fns)})")
    model_name: str | None = None
    for fn in model_fns[:1]:
        model_name = fn.name
        a = fn.args
        if a.args or a.posonlyargs or a.kwonlyargs or a.vararg or a.kwarg:
            checker.flag(fn, "the model function must take no parameters")
        for dec in fn.decorator_list:
            kind, call = _decorator_kind(dec, checker.cadgen_aliases)
            if kind is None:
                checker.flag(dec, "decorators other than @step, @glb and @stl are not allowed")
                continue
            if kind in outputs:
                checker.flag(dec, f"@{kind} is declared twice")
                continue
            if call is None or call.args:
                checker.flag(dec, f"@{kind} needs out=\"<name>{_EXTENSIONS[kind][0]}\" and no positional arguments")
                continue
            out: str | None = None
            bad = False
            for kw in call.keywords:
                if kw.arg not in _DECORATOR_KEYWORDS:
                    checker.flag(dec, f"@{kind}({kw.arg or '**'}=...) is not allowed (only out and mesh tolerances)")
                    bad = True
                elif kw.arg == "out":
                    if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                        out = kw.value.value
                    else:
                        checker.flag(dec, f"@{kind} out= must be a plain string")
                        bad = True
                elif not (isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, (int, float)) and not isinstance(kw.value.value, bool)):
                    checker.flag(dec, f"@{kind} {kw.arg}= must be a number")
                    bad = True
            if out is None:
                if not bad:
                    checker.flag(dec, f"@{kind} needs out=\"<name>{_EXTENSIONS[kind][0]}\"")
                continue
            if out.startswith(("/", "\\")) or "/" in out or "\\" in out or ".." in out or ":" in out or not _BARE_FILENAME.match(out):
                checker.flag(dec, f"@{kind} out={out!r} must be a bare filename in the job folder (no paths)")
                continue
            if not out.lower().endswith(_EXTENSIONS[kind]):
                checker.flag(dec, f"@{kind} out={out!r} must end in {' or '.join(_EXTENSIONS[kind])}")
                continue
            if out in outputs.values():
                checker.flag(dec, f"out={out!r} is used twice")
                continue
            outputs[kind] = out

    if len(guards) != 1:
        checker.flag(guards[1] if len(guards) > 1 else None, 'the script must end with one `if __name__ == "__main__":` guard')
    else:
        body = guards[0].body
        ok_body = (
            len(body) == 1
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Call)
            and isinstance(body[0].value.func, ast.Name)
            and body[0].value.func.id == model_name
            and not body[0].value.args
            and not body[0].value.keywords
        )
        if not ok_body:
            checker.flag(guards[0], "the __main__ guard must only call the model function")

    violations = sorted(set(checker.violations), key=lambda v: (v[0], v[1]))
    return GateResult(ok=not violations, violations=violations, outputs=outputs if not violations else {}, model_name=model_name)
