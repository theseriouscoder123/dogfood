import { z } from "zod";
import { LOCAL_FILE } from "../routes/uploads";

const httpUrl = z.url({ protocol: /^https?$/ });

/** Optional link: http(s) only (no javascript: or data: URLs). "" clears it. */
export const optionalUrl = z.union([httpUrl, z.literal("").transform(() => null), z.null()]);

/** Optional image: one of our uploaded files, or an http(s) URL. "" clears it. */
export const optionalImage = z.union([z.string().regex(LOCAL_FILE), httpUrl, z.literal("").transform(() => null), z.null()]);
