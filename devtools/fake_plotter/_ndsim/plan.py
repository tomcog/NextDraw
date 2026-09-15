"""
Turn a flattened drawing into the plan a plot follows: the order the lines are drawn in, the
pen-up moves between them, and how long the whole thing takes.

The timing is an approximation of the real machine, not a copy of its motion planner: a
trapezoidal speed profile per move, plus a servo delay for each pen lift and drop. Times are
in the right region for comparing settings, but don't expect them to match the real plotter
minute for minute.
"""

import math

# Top speed at 100%, in inches per second, for an AxiDraw-class machine.
MAX_SPEED_IN_S = 15.0
# Acceleration at the default setting (50), in inches per second squared.
BASE_ACCEL_IN_S2 = 40.0


def speeds(options):
    """(pen-down, pen-up) inches per second, and acceleration, from the options."""
    down = MAX_SPEED_IN_S * max(1, int(options.speed_pendown)) / 100
    up = MAX_SPEED_IN_S * max(1, int(options.speed_penup)) / 100
    accel = BASE_ACCEL_IN_S2 * max(1, int(options.accel)) / 50
    return down, up, accel


def move_time(distance, speed, accel):
    """A trapezoidal (or triangular, when short) speed profile over `distance`."""
    if distance <= 0:
        return 0.0
    ramp = speed ** 2 / accel  # distance needed to speed up and slow down again
    if distance < ramp:
        return 2 * math.sqrt(distance / accel)
    return distance / speed + speed / accel


def pen_time(options, raising):
    """How long the servo takes to lift or drop the pen, in seconds."""
    span = abs(int(options.pen_pos_up) - int(options.pen_pos_down)) / 100
    rate = max(1, int(options.pen_rate_raise if raising else options.pen_rate_lower)) / 100
    return 0.06 + span * 0.9 / rate


def order_paths(paths, reordering):
    """
    Put the lines in plotting order. The real software's reordering has four levels; this keeps
    the useful distinction: leave them alone, or walk to the nearest next line, optionally
    drawing a line backwards when that end is closer.
    """
    if reordering <= 0 or len(paths) < 2:
        return list(paths)
    allow_reverse = reordering >= 2
    remaining = list(paths)
    ordered = [remaining.pop(0)]
    here = ordered[0][-1]
    while remaining:
        best, best_distance, flip = 0, None, False
        for index, points in enumerate(remaining):
            start = math.hypot(points[0][0] - here[0], points[0][1] - here[1])
            if best_distance is None or start < best_distance:
                best, best_distance, flip = index, start, False
            if allow_reverse:
                end = math.hypot(points[-1][0] - here[0], points[-1][1] - here[1])
                if end < best_distance:
                    best, best_distance, flip = index, end, True
        points = remaining.pop(best)
        if flip:
            points = points[::-1]
        ordered.append(points)
        here = points[-1]
    return ordered


class Plan:
    """
    The moves of one plot: for each, whether the pen is down, where it goes, when it starts and
    ends, and how much pen-down distance has been drawn at each end. Times include the servo
    delay for every pen lift and drop.
    """

    def __init__(self, paths, options):
        self.paths = paths
        down_speed, up_speed, accel = speeds(options)
        self.moves = []             # (pen_down, start, end, t_start, t_end, drawn_start, drawn_end)
        self.pen_lifts = 0
        self.pendown_in = 0.0
        self.penup_in = 0.0
        clock = 0.0
        here = (0.0, 0.0)
        for points in paths:
            travel = math.hypot(points[0][0] - here[0], points[0][1] - here[1])
            if travel > 1e-9 or not self.moves:
                seconds = move_time(travel, up_speed, accel)
                self.moves.append((False, here, points[0], clock, clock + seconds,
                                   self.pendown_in, self.pendown_in))
                clock += seconds
                self.penup_in += travel
            clock += pen_time(options, raising=False)
            self.pen_lifts += 1
            for index in range(len(points) - 1):
                start, end = points[index], points[index + 1]
                distance = math.hypot(end[0] - start[0], end[1] - start[1])
                seconds = move_time(distance, down_speed, accel)
                self.moves.append((True, start, end, clock, clock + seconds,
                                   self.pendown_in, self.pendown_in + distance))
                clock += seconds
                self.pendown_in += distance
            clock += pen_time(options, raising=True)
            here = points[-1]
        self.seconds = clock
        self.end = here

    def state_at(self, when):
        """(position, pen-down inches drawn, finished) at `when` seconds into the plot."""
        if when >= self.seconds or not self.moves:
            return self.end, self.pendown_in, True
        position, drawn = self.moves[0][1], 0.0
        for down, start, end, t_start, t_end, drawn_start, drawn_end in self.moves:
            if when >= t_end:
                position, drawn = end, drawn_end
                continue
            if when <= t_start:
                break  # in a pen lift or drop between moves: still where the last one ended
            fraction = (when - t_start) / (t_end - t_start)
            position = (start[0] + (end[0] - start[0]) * fraction,
                        start[1] + (end[1] - start[1]) * fraction)
            drawn = drawn_start + (drawn_end - drawn_start) * fraction if down else drawn_end
            break
        return position, drawn, False

    def time_for(self, drawn_inches):
        """When `drawn_inches` of pen-down travel have been drawn, for resuming a stopped plot."""
        if drawn_inches <= 0:
            return 0.0
        for down, _start, _end, t_start, t_end, drawn_start, drawn_end in self.moves:
            if down and drawn_end >= drawn_inches:
                span = drawn_end - drawn_start
                fraction = 1.0 if span <= 0 else (drawn_inches - drawn_start) / span
                return t_start + (t_end - t_start) * fraction
        return self.seconds
