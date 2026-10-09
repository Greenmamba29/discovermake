"""DiscoverMake CAD worker (R2, EPIC-100-4).

Turns a structured, bounded ``CadSpec`` into manufacturing artifacts with CadQuery.
It never executes model-written code: the CAD agent picks a parametric family and
fills its parameters, and this worker validates every bound before building.
"""

__version__ = "0.2.0"
