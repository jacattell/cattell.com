---
title: "Contact me"
# Lets this page include the "are you human" check.
templateEngineOverride: njk,md
---

Contact me via:

- [BlueSky](https://bsky.app/profile/jacattell.bsky.social),
- [email](mailto:james@cattell.com),
- [LinkedIn](https://www.linkedin.com/in/jacattell/),
- [Mastodon](https://mastodon.me.uk/deck/@jacattell),
- [X (Twitter)](https://x.com/jaCattell),
- [YouTube](https://www.youtube.com/@jacattell).

## Send me a message

Your message is emailed to me; it is not stored on this website.

<form class="site-form" method="post" action="/api/form">
  <input type="hidden" name="form" value="contact">
  <label for="message">How can I help?</label>
  <textarea id="message" name="message" rows="6" maxlength="5000" required></textarea>
  <label for="email">Your email address</label>
  <input type="email" id="email" name="email" maxlength="254" autocomplete="email" required>
  <div class="trap" aria-hidden="true">
    <label for="website">Leave this empty</label>
    <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
  </div>
  {% include "human-check.njk" %}
  <button type="submit">Send message</button>
</form>
