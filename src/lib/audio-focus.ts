/**
 * The smallest possible audio coordinator: whoever starts sound claims focus, and the previous
 * holder is asked to pause, so two sources never play over each other. A single controller for
 * all audio replaces this later.
 */
export type AudioClaim = { release: () => void };

type Holder = { pause: () => void };

let holder: Holder | undefined;

export function claimAudio(pause: () => void): AudioClaim {
  const previous = holder;
  const mine: Holder = { pause };
  holder = mine;
  if (previous && previous !== mine) previous.pause();
  return {
    release() {
      if (holder === mine) holder = undefined;
    },
  };
}
