"""The build123d names a Make AI script may reach through ``bd.<name>``.

Snapshot of ``build123d.__all__`` for build123d 0.11.1 (the version cadgen 0.7.20 installs),
minus everything that reads or writes files, lists the machine's fonts, or encodes data for
export. The gate runs in the worker's own environment (CadQuery), where build123d is not
installed, so the list is static. Regenerate it when the cadgen pin changes:

    $CADGEN_PYTHON -I -c "import build123d, json; print(json.dumps(sorted(build123d.__all__)))"
"""

from __future__ import annotations

BUILD123D_ALL = frozenset(
    """
    Airfoil Align AngularDirection ApproxOption ArcArcTangentArc ArcArcTangentLine Arrow ArrowHead Axis
    BSpline BallJoint BaseLineObject BasePartObject BaseSketchObject Bezier BlendCurve BoundBox Box
    BuildLine BuildPart BuildSketch CM CenterArc CenterOf Circle Color Compound Cone ConstrainedArcs
    ConstrainedLines ContinuityLevel ConvexPolyhedron CounterBoreHole CounterSinkHole Curve Cylinder
    CylindricalJoint DimensionLine DotLength DoubleTangentArc Draft DraftAngleError Edge Ellipse
    EllipticalCenterArc EllipticalStartArc Export2D ExportDXF ExportSVG ExtensionLine Extrinsic FT Face
    FilletPolyline FontManager FontStyle FrameMethod G GeomEncoder GeomType GridLocations HeadType Helix
    HexLocations Hole HyperbolicCenterArc IN IntersectingLine Intrinsic JernArc Joint KG Keep Kind LB
    LengthMode Line LineType LinearJoint Location LocationEncoder Locations M MC MM Matrix MeshType Mesher
    Mode NumberDisplay OrientedBoundBox PageSize ParabolicCenterArc Part Plane PointArcTangentArc
    PointArcTangentLine PolarLine PolarLocations Polygon Polyline Pos PositionMode PrecisionMode RadiusArc
    Rectangle RectangleRounded RegularPolygon RevoluteJoint RigidJoint Rot Rotation RotationLike Sagitta
    SagittaArc Select ShapeList Shell Side Sketch SlotArc SlotCenterPoint SlotCenterToCenter SlotOverall
    Solid SortBy Sphere Spline THOU Tangency TangentArc TechnicalDrawing Text TextAlign ThreePointArc Torus
    Transition Trapezoid Triangle UNITS_PER_METER Unit Until Vector VectorLike Vertex Wedge Wire add
    available_fonts bounding_box chamfer delta detect_primitives draft edge edges edges_to_wires
    export_brep export_gltf export_step export_stl export_to_pcbway extrude face faces fillet full_round
    import_brep import_dxf import_step import_stl import_svg import_svg_as_buildline_code loft
    make_brake_formed make_face make_hull mirror new_edges offset pack polar project project_workplane
    revolve scale section solid solids split sweep thicken topo_distance_to topo_explore_common_vertex
    topo_explore_connected_edges trace vertex vertices wire wires
    """.split()
)

#: File, font and export machinery: never reachable from a generated script.
BUILD123D_DENIED = frozenset(
    {
        "Export2D",
        "ExportDXF",
        "ExportSVG",
        "FontManager",
        "GeomEncoder",
        "LocationEncoder",
        "Mesher",
        "TechnicalDrawing",
        "available_fonts",
        "export_brep",
        "export_gltf",
        "export_step",
        "export_stl",
        "export_to_pcbway",
        "import_brep",
        "import_dxf",
        "import_step",
        "import_stl",
        "import_svg",
        "import_svg_as_buildline_code",
    }
)

ALLOWED_BD_NAMES = BUILD123D_ALL - BUILD123D_DENIED
