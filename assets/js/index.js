(function () {
  "use strict";

  var maps = document.getElementById("maps");
  var q = document.getElementById("q");
  var data = { maps: [], stops: [] };

  function norm(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function render() {
    var term = norm(q.value.trim());
    maps.textContent = "";
    data.maps.forEach(function (m) {
      var stops = data.stops.filter(function (s) {
        return s.map === m.id && (!term || norm(s.name).indexOf(term) !== -1 || s.id.indexOf(term) !== -1);
      });
      if (!stops.length) return;
      var h = document.createElement("h2");
      h.textContent = m.name;
      maps.appendChild(h);
      var ul = document.createElement("ul");
      ul.className = "stops";
      stops.forEach(function (s) {
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.href = "tabule.html?id=" + encodeURIComponent(s.id);
        a.appendChild(document.createTextNode(s.name));
        var id = document.createElement("span");
        id.className = "id";
        id.textContent = s.id;
        a.appendChild(id);
        li.appendChild(a);
        ul.appendChild(li);
      });
      maps.appendChild(ul);
    });
  }

  fetch("data/stops.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    render();
  });
  q.addEventListener("input", render);

  document.getElementById("custom").addEventListener("submit", function (e) {
    e.preventDefault();
    location.href = "tabule.html?src=" + encodeURIComponent(document.getElementById("src").value);
  });
})();
