/** Public copy and canonical host shared by the React app and the Worker HTML. */

export const SITE_NAME = "M365 Barometer";

/** Shown in the site footer. This project is not a Microsoft product. */
export const INDEPENDENT_DISCLAIMER = "Independent project, not affiliated with Microsoft.";

/**
 * Apex `m365-barometer.com` redirects to www. Canonical URLs use www so
 * search results don't split across the two hostnames.
 */
export const CANONICAL_ORIGIN = "https://www.m365-barometer.com";

export const HOME_DESCRIPTION =
  "Sentiment, temperature, and score for Microsoft 365 products. Independent project, not affiliated with Microsoft.";
