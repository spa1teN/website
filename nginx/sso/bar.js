/* Injected by nginx sub_filter into Nextcloud, Dawarich and Immich pages.
 * Shows the logged-in user (top-left) and a link back to the sadenius.eu
 * portal (top-right). Purely optional decoration — never blocks anything. */
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

  function fill(name, email) {
    user.textContent = "";
    var u = document.createElement("span");
    u.textContent = name || "";
    user.appendChild(u);
    if (email) {
      var em = document.createElement("span");
      em.className = "em";
      em.textContent = " " + email;
      user.appendChild(em);
    }
  }

  var host = location.hostname;
  try {
    if (host.indexOf("cloud.") === 0) {
      var cu = null;
      if (window.OC && OC.getCurrentUser) cu = OC.getCurrentUser();
      fill((cu && (cu.displayName || cu.uid)) || (window.OC ? OC.currentUser : "") || "", cu && cu.email);
    } else if (host.indexOf("fotos.") === 0) {
      fetch("/api/users/me", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (u) { if (u) fill(u.name || u.email || "", u.email && u.name ? u.email : ""); })
        .catch(function () {});
    } else if (host.indexOf("map.") === 0) {
      fetch("/users/edit", { headers: { Accept: "text/html" } })
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (h) {
          var m = h.match(/name="user\[email\]"[^>]*value="([^"]*)"/);
          if (m) fill("", m[1]);
        })
        .catch(function () {});
    }
  } catch (e) {}
})();