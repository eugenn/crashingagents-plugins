// Named JSON imports let the BB app bundler omit art that is only needed during play.
import {
  'brand/mascot' as mascot,
  'cards/deck-back' as back,
  'cards/sandbox_escape' as escape,
  'cards/reward_hacking' as reward,
  'cards/oom_ageddon' as oom,
  'cards/sycophancy_patch' as patch,
  'cards/vibe_coder' as vibe,
} from './thumbnails.json';

export default {
  'brand/mascot': mascot,
  'cards/deck-back': back,
  'cards/sandbox_escape': escape,
  'cards/reward_hacking': reward,
  'cards/oom_ageddon': oom,
  'cards/sycophancy_patch': patch,
  'cards/vibe_coder': vibe,
};
