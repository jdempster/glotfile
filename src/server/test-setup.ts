import { beforeEach } from "vitest";
import { setPriceCache } from "./ai/price-cache.js";

// Keep every server test hermetic with respect to the machine-global price
// cache (~/.glotfile/model-prices.json): a developer who has run
// `glotfile prices --refresh` must not get different test results. Nulling the
// memo makes resolvePricing skip the on-disk read entirely. Tests that exercise
// cache resolution install their own cache in a local beforeEach, which runs
// after this one.
beforeEach(() => setPriceCache(null));
