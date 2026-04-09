(function(){
  function boot(){
    const app = window.__cthApp;
    if (!app) {
      setTimeout(boot, 120);
      return;
    }

    const ui = {
      dragTeamId: null,
      draftPlacements: {},
      draftActivityName: "",
      lastRoundNumber: null,
      mounted: false
    };

    const TEAM_BRANDS = {
      mer: { short: "MER", mark: "M", accent: "#00D2BE" },
      mcl: { short: "MCL", mark: "M", accent: "#FF8700" },
      ast: { short: "AST", mark: "A", accent: "#006F62" },
      fer: { short: "FER", mark: "F", accent: "#DC0000" },
      wil: { short: "ALP", mark: "A", accent: "#FF4FBF" }
    };

    function ensureMounts(){
      const adminView = document.getElementById("adminView");
      const kidsView = document.getElementById("kidsView");
      if (!adminView || !kidsView) return false;

      if (!document.getElementById("enhAdminPanels")) {
        const wrap = document.createElement("div");
        wrap.id = "enhAdminPanels";
        wrap.className = "enhWrap";
        adminView.appendChild(wrap);
      }

      if (!document.getElementById("enhKidsPublicPanel")) {
        const panel = document.createElement("div");
        panel.id = "enhKidsPublicPanel";
        panel.className = "panel";
        const headerPanel = kidsView.querySelector(".panel");
        if (headerPanel && headerPanel.nextSibling) kidsView.insertBefore(panel, headerPanel.nextSibling);
        else kidsView.appendChild(panel);
      }
      ui.mounted = true;
      return true;
    }

    function getState(){
      return app.getClonedState();
    }

    function getTeamBrand(team){
      return TEAM_BRANDS[team.id] || {
        short: String(team.name || "TEAM").slice(0, 3).toUpperCase(),
        mark: String(team.name || "T").slice(0, 1).toUpperCase(),
        accent: team.color || "#999999"
      };
    }

    function defaultDraftFromState(state){
      const shouldReset = ui.lastRoundNumber !== state.round?.number || !Object.keys(ui.draftPlacements).length;
      if (!shouldReset) return;
      ui.lastRoundNumber = state.round?.number ?? null;
      ui.draftPlacements = {};
      state.teams.forEach((team, index) => {
        ui.draftPlacements[team.id] = state.round?.placements?.[team.id] ?? (index + 1);
      });
      ui.draftActivityName = state.round?.activityName || "";
    }

    function renderPublicPanelV2(state){
      const mount = document.getElementById("enhKidsPublicPanel");
      if (!mount) return;
      const onTrack = state.teams.filter(t => !t.offTrack).sort((a,b) => b.total - a.total);
      const leader = onTrack[0];
      const last = state.history?.[0];
      const groupedDraftTeams = [1,2,3,4,5].map(place => ({
        place,
        teams: state.teams
          .filter(team => (parseInt(ui.draftPlacements[team.id], 10) || 0) === place)
          .sort((a,b) => a.name.localeCompare(b.name))
      }));
      const standings = state.teams.slice().sort((a,b) => {
        if (a.offTrack && b.offTrack) return 0;
        if (a.offTrack) return 1;
        if (b.offTrack) return -1;
        return b.total - a.total;
      }).map((team, index) => {
        const pos = app.teamLapTile(team);
        return { rank:index + 1, team, lap:pos.lap, tile:pos.tile };
      });
      const recentRounds = (state.roundArchive || []).slice().sort((a,b) => (b.roundNo || 0) - (a.roundNo || 0)).slice(0, 2);
      const preview = app.buildBatchRoundPreview(ui.draftPlacements);
      mount.innerHTML = `
        <div class="kidsPublicHero kidsF1Hero">
          <div class="kidsPublicCard kidsF1Card kidsF1TitleCard">
            <div class="enhMuted">Velk&aacute; cena</div>
            <div class="big">${escapeHtml(state.settings?.raceName || "VC Klondike")}</div>
            <div class="kidsF1Stripe"></div>
          </div>
          <div class="kidsPublicCard kidsF1Card">
            <div class="enhMuted">Leader</div>
            <div class="big">${leader ? escapeHtml(leader.name) : "&mdash;"}</div>
            <div class="kidsF1Subline">${leader ? `Timing tower &bull; ${leader.total} pol&iacute;` : "&#268;ek&aacute;me na start"}</div>
          </div>
          <div class="kidsPublicCard kidsF1Card">
            <div class="enhMuted">Posledn&iacute; zm&#283;na</div>
            <div>${last ? escapeHtml(last.event?.title || last.source || "zm&#283;na") : "Zat&iacute;m bez zm&#283;n"}</div>
            <div class="enhMuted" style="margin-top:4px;">${last ? escapeHtml(last.event?.text || last.teamName || "") : ""}</div>
          </div>
        </div>
        <div class="kidsPublicCard kidsF1Card kidsDraftPanel">
          <div class="enhHistoryHead">
            <div>
              <div class="enhMuted">Race control &bull; d&#283;tsk&eacute; zad&aacute;n&iacute; kola</div>
              <div class="big" style="font-size:18px;">P&#345;et&aacute;hni t&yacute;my na 1.&ndash;5. m&iacute;sto</div>
            </div>
            <button class="btnOk" data-enh-action="apply-kids-batch">Potvrdit po&#345;ad&iacute;</button>
          </div>
          <div class="enhMuted" style="margin-top:6px;">Na stejn&eacute; m&iacute;sto m&#367;&#382;e&scaron; um&iacute;stit v&iacute;c t&yacute;m&#367;. Vyhodnocen&iacute; prob&iacute;h&aacute; od posledn&iacute;ho t&yacute;mu v pr&#367;b&#283;&#382;n&eacute;m po&#345;ad&iacute; k prvn&iacute;mu.</div>
          <div class="kidsTopLayout">
            <div class="kidsDraftArea">
              <div class="kidsDraftBoard">
                ${groupedDraftTeams.map(group => `
                  <div class="kidsDraftSlot" data-kids-slot="${group.place}">
                    <div class="kidsDraftPlace">${group.place}.</div>
                    <div class="kidsDraftLane">
                      ${group.teams.length ? group.teams.map(team => `
                        <div class="kidsDraftTeam" draggable="true" data-kids-team="${team.id}" style="--team-accent:${getTeamBrand(team).accent}; --team-accent-rgb:${hexToRgbString(getTeamBrand(team).accent)};">
                          <div class="kidsTeamLead">
                            <span class="kidsTeamLogo" style="--logo-accent:${getTeamBrand(team).accent};">${escapeHtml(getTeamBrand(team).mark)}</span>
                            <div>
                              <div class="kidsTeamNameRow">
                                <span class="kidsTeamWordmark">${escapeHtml(getTeamBrand(team).short)}</span>
                                <strong>${escapeHtml(team.name)}</strong>
                              </div>
                              <div class="kidsDraftMeta">${team.offTrack ? "Mimo tra&#357;" : `${team.total} pol&iacute;`} &bull; p&#345;et&aacute;hni na pozici</div>
                            </div>
                          </div>
                          <div class="kidsDraftMeta kidsMetaPill">${team.offTrack ? "Mimo tra&#357;" : `P${group.place}`}</div>
                        </div>
                      `).join("") : `<div class="kidsDraftEmpty">Sem p&#345;et&aacute;hni t&yacute;m(y) na ${group.place}. m&iacute;sto</div>`}
                    </div>
                  </div>
                `).join("")}
              </div>
              <div class="enhPreviewList">
                <div class="enhPreviewItem">
                  <strong>N&aacute;hled:</strong>
                  ${preview.ok ? `${preview.collisions.length} koliz&iacute; &bull; ${preview.eventTiles.length} event trigger&#367; po uzav&#345;en&iacute; kola` : escapeHtml(preview.issues.join(", "))}
                </div>
                <div class="enhPreviewItem">
                  <strong>Vyhodnocen&iacute; po&#345;ad&iacute;:</strong>
                  ${preview.ok ? preview.order.map(item => {
                    const team = state.teams.find(t => t.id === item.teamId);
                    return `${escapeHtml(team?.name || item.teamId)} (${item.place}. m&iacute;sto)`;
                  }).join(" &rarr; ") : "&#268;ek&aacute; na kompletn&iacute; zad&aacute;n&iacute;"}
                </div>
              </div>
            </div>
            <div class="kidsTrackArea">
              <div class="kidsTrackPanelHost"></div>
            </div>
          </div>
          <div class="kidsBottomLayout">
            <div class="enhPreviewList">
              <div class="enhPreviewItem"><strong>Aktu&aacute;ln&iacute; po&#345;ad&iacute;</strong></div>
              ${standings.map(item => `
                <div class="enhPreviewItem">
                  <strong>${item.rank}.</strong> ${escapeHtml(item.team.name)}
                  <span class="enhMuted"> &bull; ${item.team.offTrack ? "mimo tra&#357;" : `${item.team.total} pol&iacute; &bull; okruh ${item.lap} &bull; pol&iacute;&#269;ko ${item.tile}`}</span>
                </div>
              `).join("")}
            </div>
            <div class="enhPreviewList">
              <div class="enhPreviewItem"><strong>Posledn&iacute; 2 kola</strong></div>
              ${recentRounds.length ? recentRounds.map(round => `
                <div class="enhPreviewItem kidsRoundLog">
                  <div><strong>${round.roundNo}. ${escapeHtml(round.activityName || "Bez n&aacute;zvu")}</strong></div>
                  <div class="kidsRoundLogLine">Posuny: ${Object.entries(round.deltas || {}).filter(([,delta]) => delta != null).map(([teamId, delta]) => {
                    const team = state.teams.find(t => t.id === teamId);
                    return `${escapeHtml(team ? team.name : teamId)} ${delta > 0 ? "+" : ""}${delta}`;
                  }).join(" &bull; ") || "bez posunu"}</div>
                  <div class="kidsRoundLogLine">Ud&aacute;losti: ${(round.resolvedEvents || []).length ? round.resolvedEvents.map(ev => {
                    const team = state.teams.find(t => t.id === ev.teamId);
                    return `${escapeHtml(team ? team.name : ev.teamId)}: ${escapeHtml(ev.title)}`;
                  }).join(" &bull; ") : "&#382;&aacute;dn&eacute;"}</div>
                </div>
              `).join("") : `<div class="enhPreviewItem">Zat&iacute;m nejsou potvrzena &#382;&aacute;dn&aacute; dv&#283; kola.</div>`}
            </div>
          </div>
        </div>
      `;
      const trackHost = mount.querySelector(".kidsTrackPanelHost");
      const trackPanel = document.querySelector("#kidsView .kidsRight .trackBox");
      if (trackHost && trackPanel) {
        trackHost.innerHTML = `<div class="panel trackBox kidsTrackReplica">${trackPanel.innerHTML}</div>`;
      }
    }

    function refresh(){
      const state = getState();
      defaultDraftFromState(state);
      renderPublicPanelV2(state);
    }

    document.addEventListener("dragstart", function(event){
      const row = event.target.closest(".kidsDraftTeam");
      if (!row) return;
      ui.dragTeamId = row.getAttribute("data-kids-team");
      row.classList.add("dragging");
    });

    document.addEventListener("dragend", function(event){
      const row = event.target.closest(".kidsDraftTeam");
      if (!row) return;
      row.classList.remove("dragging");
      ui.dragTeamId = null;
      document.querySelectorAll(".kidsDraftSlot").forEach(el => el.classList.remove("drag-over"));
    });

    document.addEventListener("dragover", function(event){
      const slot = event.target.closest(".kidsDraftSlot");
      if (!slot || !ui.dragTeamId) return;
      event.preventDefault();
      slot.classList.add("drag-over");
    });

    document.addEventListener("drop", function(event){
      const slot = event.target.closest(".kidsDraftSlot");
      if (!slot || !ui.dragTeamId) return;
      event.preventDefault();
      document.querySelectorAll(".kidsDraftSlot").forEach(el => el.classList.remove("drag-over"));
      const place = parseInt(slot.getAttribute("data-kids-slot"), 10);
      if (![1,2,3,4,5].includes(place)) return;
      ui.draftPlacements[ui.dragTeamId] = place;
      refresh();
    });

    document.addEventListener("click", function(event){
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const actionEl = target.closest("[data-enh-action]");
      if (!actionEl) return;
      const action = actionEl.getAttribute("data-enh-action");
      if (action === "apply-kids-batch") {
        const validation = app.applyBatchRound(ui.draftPlacements, ui.draftActivityName);
        if (validation?.ok) app.showToast("Poradi zadano. Dokonci potvrzeni kola.");
      }
    });

    window.__cthEnhancementsRender = refresh;
    refresh();
  }

  function escapeHtml(value){
    return String(value ?? "").replace(/[&<>"']/g, function(ch){
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[ch];
    });
  }

  function hexToRgbString(hex){
    const value = String(hex || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(value)) return "160,160,160";
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16)
    ].join(",");
  }

  boot();
})();
