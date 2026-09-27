// Throwaway-inbox providers, bundled so the check works offline. Not exhaustive (new ones appear
// daily); it raises the cost of the laziest ballot stuffing, and the detection signals catch
// what gets through. Organizers who need more can restrict voting to their own domains.
const DISPOSABLE = new Set([
  "10minutemail.com", "10minutemail.net", "20minutemail.com", "33mail.com", "anonaddy.me", "burnermail.io", "discard.email", "discardmail.com",
  "dispostable.com", "dropmail.me", "emailondeck.com", "emailtemporanea.com", "fakeinbox.com", "fakemail.net", "getairmail.com", "getnada.com",
  "guerrillamail.biz", "guerrillamail.com", "guerrillamail.de", "guerrillamail.info", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com",
  "harakirimail.com", "inboxbear.com", "incognitomail.org", "jetable.org", "mail-temp.com", "mailcatch.com", "maildrop.cc", "mailinator.com",
  "mailinator.net", "mailinator2.com", "mailnesia.com", "mailpoof.com", "mailsac.com", "mailtemp.net", "mintemail.com", "moakt.com", "mohmal.com",
  "mytemp.email", "mytrashmail.com", "nada.email", "nowmymail.com", "one-time.email", "sharklasers.com", "spam4.me", "spambox.us", "spamgourmet.com",
  "spamex.com", "tempail.com", "tempinbox.com", "tempmail.com", "tempmail.dev", "tempmail.net", "tempmail.plus", "tempmailo.com", "temp-mail.io",
  "temp-mail.org", "temporary-mail.net", "throwam.com", "throwawaymail.com", "tmail.ws", "tmpmail.net", "tmpmail.org", "trash-mail.com",
  "trashmail.com", "trashmail.de", "trashmail.net", "trbvm.com", "wegwerfmail.de", "yopmail.com", "yopmail.fr", "yopmail.net", "zetmail.com",
  "grr.la", "guerrillamail.email", "mailforspam.com", "mailnull.com", "spamdecoy.net", "tempr.email", "emailfake.com", "fakemailgenerator.com",
  "inboxkitten.com", "linshiyouxiang.net", "mailto.plus", "minuteinbox.com", "tempmailaddress.com", "10mail.org", "dropmail.me", "emlhub.com",
]);

/** True for known throwaway providers, including their subdomains. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  if (DISPOSABLE.has(domain)) return true;
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) if (DISPOSABLE.has(parts.slice(i).join("."))) return true;
  return false;
}
