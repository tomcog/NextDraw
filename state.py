"""The handful of things that change while the app runs, in one place (Tom, 2026-11-24).

Not settings and not files: the live state - whether the last plot was stopped, what the pages have
been told, the queue as last read. They are here because they are REBOUND, not just mutated, and a
rebound name does not survive being split across modules: `state.last_plot_stopped = True` in one
file would leave another file's copy as it was, and nothing would say so until a plot refused to
resume. One object, one copy, every module reading the same fields.
"""


class State:
    """Live state, shared by every module that has to know it. Fields, not globals, so a write in one
    place is a read in another."""

    def __init__(self):
        # Whether the last plot ended by being stopped. A stop leaves the motors on and the step count
        # true, so going home from there is a straight walk back - not the homing sweep, which exists
        # for a position that can't be trusted. Cleared by any plot that isn't stopped.
        self.last_plot_stopped = False
        # The settings every open Plot page shows - this Mac's screen and any other device's - so
        # whichever screen you look at shows what a plot would use. Read from disk at startup.
        self.shared_settings = {"settings": None, "preset": None, "version": None}
        # Changes each time a page saves its choices for the drawing (placement, scale, layers...), so
        # the other open pages know to take them up. In memory: a restart reloads the drawing afresh.
        self.drawing_saved = None
        # The queue as this Mac last read or wrote it, and the file it came from, so a change made on
        # the other Mac is noticed. None until first use.
        self.queue = None
        self.queue_stamp = None


state = State()
