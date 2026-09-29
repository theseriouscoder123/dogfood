/*
 * Verdict gallery embed. Put this where the gallery should appear:
 *
 *   <script src="https://YOUR-PORTAL/embed.js" data-event="your-event-slug" async></script>
 *
 * Options (all optional): data-theme="auto|light|dark", data-track="<track id>",
 * data-search="false" (hide the search box), data-winners="false" (hide medal badges).
 *
 * It inserts an iframe of YOUR-PORTAL/embed/<slug> and keeps its height in step with the content.
 * Height messages are only accepted from that iframe, so other frames on the page can't resize it.
 */
(function () {
  "use strict";
  var scripts = document.querySelectorAll("script[data-event]:not([data-dogfood-mounted])");
  for (var i = 0; i < scripts.length; i++) mount(scripts[i]);

  function mount(script) {
    if (!/\/embed\.js(\?|$)/.test(script.src)) return;
    script.setAttribute("data-dogfood-mounted", "");
    var origin = new URL(script.src).origin;
    var slug = script.getAttribute("data-event");
    var params = new URLSearchParams();
    var theme = script.getAttribute("data-theme");
    if (theme === "light" || theme === "dark") params.set("theme", theme);
    if (script.getAttribute("data-track")) params.set("track", script.getAttribute("data-track"));
    if (script.getAttribute("data-search") === "false") params.set("search", "0");
    if (script.getAttribute("data-winners") === "false") params.set("winners", "0");

    var frame = document.createElement("iframe");
    frame.src = origin + "/embed/" + encodeURIComponent(slug) + (params.toString() ? "?" + params : "");
    frame.title = "Projects from " + slug;
    frame.loading = "lazy";
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.style.cssText = "width:100%;height:640px;border:0;border-radius:16px;display:block;color-scheme:normal";
    script.parentNode.insertBefore(frame, script.nextSibling);

    window.addEventListener("message", function (e) {
      if (e.source !== frame.contentWindow || e.origin !== origin) return;
      var d = e.data;
      if (d && d.type === "dogfood:embed-height" && typeof d.height === "number" && d.height > 0 && d.height < 100000) frame.style.height = d.height + "px";
    });
  }
})();
