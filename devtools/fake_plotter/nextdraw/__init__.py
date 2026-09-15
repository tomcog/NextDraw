"""Stand-in for the `nextdraw` package: the same NextDraw class the real one re-exports."""

from nextdrawcore.nextdraw import NextDraw  # noqa: F401

__all__ = ["NextDraw"]
