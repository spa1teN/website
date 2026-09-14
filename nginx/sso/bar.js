/* Injected by nginx sub_filter into Dawarich and Immich pages.
 * Nextcloud gets a server-side bar (username from nc_username cookie, no JS —
 * NC's CSP uses a per-response nonce + strict-dynamic, which blocks injected
 * scripts). Shows the logged-in user (top-left) and a link back to the
 * sadenius.eu portal (top-right). Purely optional decoration. */
(function () {
  var bar = document.getElementById("sadenius-sso-bar");
  if (!bar) return;
  var user = document.createElement("span");
  user.className = "u";
  var link = document.createElement("a");
  link.href = "https://sadenius.eu/portal/";
  link.textContent = "\u2190 Portal";
  link.target = "_blank";
  link.rel = "noopener";
  bar.appendChild(user);
  bar.appendChild(link);

  function fill(name) {
    user.textContent = name || "";
  }

  var host = location.hostname;
  try {
    if (host.indexOf("fotos.") === 0) {
      fetch("/api/users/me", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (u) { if (u) fill(u.name || u.email || ""); })
        .catch(function () {});
    } else if (host.indexOf("map.") === 0) {
      fetch("/users/edit", { headers: { Accept: "text/html" } })
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (h) {
          var m = h.match(/name="user\[email\]"[^>]*value="([^"]*)"|value="([^"]*)"[^>]*name="user\[email\]"/);
          if (m) fill(m[1] || m[2]);
        })
        .catch(function () {});
    }
  } catch (e) {}
})();