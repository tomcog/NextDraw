// A whole photo split into a profile's inks and written as a Multichannel Photoshop file, off the
// page: seven inks over twelve million pixels is seconds of work. See profilePsd.ts.
import { inkPlanes, type InkProfile, type Rendering } from "../../shared/lib/drawing/icc";
import { multichannelPsd } from "./multichannelPsd";

export interface ProfilePsdJob {
  profile: InkProfile;
  rendering: Rendering;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  names: string[];
  colors: string[];
  labs?: [number, number, number][];
}

self.onmessage = (e: MessageEvent<ProfilePsdJob>) => {
  const { profile, rendering, width, height, rgba, names, colors, labs } = e.data;
  try {
    const planes = inkPlanes(profile, rgba, rendering);
    const psd = multichannelPsd(width, height, planes.map((plane, i) => ({ name: names[i], color: colors[i], lab: labs?.[i], plane })));
    (self as unknown as Worker).postMessage({ psd }, [psd.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: (err as Error).message });
  }
};
