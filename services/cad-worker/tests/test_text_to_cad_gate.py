"""The static gate: what a Make AI script may and may not contain. Pure: nothing runs."""

import textwrap

import pytest

from cad_worker.text_to_cad.gate import MAX_SCRIPT_BYTES, check

GOOD = textwrap.dedent(
    '''
    """A plate with two holes."""
    from __future__ import annotations

    import math
    from typing import Sequence

    from cadgen import build123d as bd
    from cadgen import glb, step, stl

    WIDTH = 40.0


    def holes(xs: Sequence[float]):
        return [bd.Pos(x, 0, 0) * bd.Cylinder(2.5, 20) for x in xs]


    @step(out="model.step")
    @glb(out="model.glb", mesh_tolerance=0.05)
    @stl(out="model.stl")
    def model():
        body = bd.Box(WIDTH, 20, 6)
        body = bd.fillet(body.edges().filter_by(bd.Axis.Z), radius=3)
        for _ in range(1):
            for h in holes([-12, 12]):
                body = body - h
        label = bd.Text("HI", 5)
        return body + bd.Pos(0, 0, 3) * bd.extrude(label, amount=1) * (math.pi / math.pi)


    if __name__ == "__main__":
        model()
    '''
)


def with_body(body: str, header: str = "") -> str:
    return (
        "from cadgen import build123d as bd\nfrom cadgen import step\n"
        + header
        + '\n@step(out="model.step")\ndef model():\n'
        + textwrap.indent(textwrap.dedent(body), "    ")
        + '\n\nif __name__ == "__main__":\n    model()\n'
    )


def rules(script: str) -> list[str]:
    r = check(script)
    assert not r.ok
    return [rule for _, rule in r.violations]


def test_accepts_a_plain_model_and_reports_outputs():
    r = check(GOOD)
    assert r.ok, r.violations
    assert r.outputs == {"step": "model.step", "glb": "model.glb", "stl": "model.stl"}
    assert r.model_name == "model"


@pytest.mark.parametrize(
    "header",
    [
        "import os\n",
        "import subprocess\n",
        "import socket\n",
        "import sys\n",
        "import cadgen\n",
        "from os import path\n",
        "from cadgen import read_step\n",
        "from cadgen.build123d import Box\n",
        "from . import x\n",
        "import math as m, pathlib\n",
        "from __future__ import braces\n",
    ],
)
def test_rejects_imports(header):
    r = check(with_body("return bd.Box(1, 1, 1)", header))
    assert not r.ok
    assert any("import" in rule for _, rule in r.violations)
    assert all(line >= 1 for line, _ in r.violations)


@pytest.mark.parametrize(
    "body,needle",
    [
        ("open('/etc/passwd')\nreturn bd.Box(1, 1, 1)", "'open'"),
        ("with open('x') as f:\n    pass\nreturn bd.Box(1, 1, 1)", "open"),
        ("eval('1')\nreturn bd.Box(1, 1, 1)", "'eval'"),
        ("exec('x = 1')\nreturn bd.Box(1, 1, 1)", "'exec'"),
        ("compile('1', 'x', 'eval')\nreturn bd.Box(1, 1, 1)", "'compile'"),
        ("__import__('os')\nreturn bd.Box(1, 1, 1)", "underscore"),
        ("getattr(bd, 'Box')\nreturn bd.Box(1, 1, 1)", "'getattr'"),
        ("globals()\nreturn bd.Box(1, 1, 1)", "'globals'"),
        ("b = bd.Box(1, 1, 1)\nreturn b.__class__", "underscore"),
        ("return ().__class__.__bases__[0]", "underscore"),
        ("return bd.__dict__", "underscore"),
        ("_x = 1\nreturn bd.Box(1, 1, 1)", "underscore"),
        ("g = (x for x in [1])\nreturn g.gi_frame.f_globals", "gi_frame"),
        ("return '{0.__class__}'.format(1)", "format"),
        ("bd.export_stl(bd.Box(1, 1, 1), '/tmp/x.stl')\nreturn bd.Box(1, 1, 1)", "export"),
        ("return bd.import_step('/etc/x.step')", "import_step"),
        ("return bd.Text('A', 5, 'Arial', '/etc/passwd')", "Text"),
        ("return bd.Text('A', 5, font_path='/etc/passwd')", "font_path"),
        ("return bd.Mesher()", "Mesher"),
        ("print(breakpoint)\nreturn bd.Box(1, 1, 1)", "'breakpoint'"),
    ],
)
def test_rejects_dangerous_names(body, needle):
    found = rules(with_body(body))
    assert any(needle in r for r in found), found


def test_rejects_absolute_and_dotdot_out_paths():
    for out in ["/tmp/model.step", "../model.step", "sub/model.step", "..\\\\model.step", "model.stl", "C:model.step", ""]:
        script = GOOD.replace('@step(out="model.step")', f'@step(out="{out}")')
        found = rules(script)
        assert any("out=" in r or "@step" in r for r in found), (out, found)


def test_rejects_other_decorators_and_unknown_decorator_keywords():
    found = rules(GOOD.replace("@stl(out=\"model.stl\")", "@stl(out=\"model.stl\", kinematics={})"))
    assert any("kinematics" in r for r in found)
    found = rules(GOOD.replace("@step(out=\"model.step\")", "@step(out=\"model.step\")\n@staticmethod"))
    assert any("decorators other than" in r for r in found)


def test_requires_exactly_one_model():
    two = GOOD.replace('if __name__ == "__main__":', '@stl(out="b.stl")\ndef other():\n    return bd.Box(1, 1, 1)\n\n\nif __name__ == "__main__":')
    assert any("exactly one decorated model" in r for r in rules(two))
    none = with_body("return bd.Box(1, 1, 1)").replace('@step(out="model.step")\n', "")
    assert any("exactly one decorated model" in r for r in rules(none))


def test_requires_the_main_guard():
    script = GOOD.split('if __name__ == "__main__":')[0]
    assert any("__main__" in r for r in rules(script))
    other = GOOD.replace("    model()\n", "    import os\n")
    assert any("guard" in r or "import" in r for r in rules(other))


def test_rejects_top_level_code_and_classes():
    assert any("top level" in r for r in rules(GOOD.replace("WIDTH = 40.0", "for i in range(3):\n    pass")))
    assert any("class" in r for r in rules(GOOD.replace("WIDTH = 40.0", "class A:\n    pass")))


def test_model_function_takes_no_parameters():
    assert any("no parameters" in r for r in rules(GOOD.replace("def model():", "def model(width=1):")))


def test_oversize_is_rejected_unread():
    big = GOOD + "#" * (MAX_SCRIPT_BYTES + 1)
    r = check(big)
    assert not r.ok and r.violations[0][0] == 0 and "limit" in r.violations[0][1]


def test_syntax_error_is_reported_with_its_line_not_as_a_violation():
    r = check("from cadgen import step\n\ndef model(:\n    pass\n")
    assert not r.ok and r.syntax_error is not None and r.syntax_error[0] == 3 and not r.violations


def test_violation_lines_point_at_the_offending_statement():
    script = with_body("x = 1\nopen('a')\nreturn bd.Box(1, 1, 1)")
    r = check(script)
    lines = script.splitlines()
    for line, _ in r.violations:
        assert "open" in lines[line - 1]
