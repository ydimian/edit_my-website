// Where the portfolio site's files are, for tests and the mock GitHub server:
// $SITE_DIR if set, otherwise the folder this editor sits in (the usual local setup).
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

export const SITE = process.env.SITE_DIR
  ? pathToFileURL(`${process.env.SITE_DIR.replace(/[\/]+$/, "")}/`)
  : new URL("../../", import.meta.url);
export const hasSite = existsSync(new URL("index.html", SITE));

/** test() that is skipped when the site isn't available. */
export const siteTest = hasSite ? test : (name, fn) => test.skip(`${name} (needs the portfolio site: set SITE_DIR)`, fn);
