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

    function renderDashboard(state){
      const mount = document.getElementById("enhDashboard");
      if (!mount) return;
      const onTrack = state.teams.filter(t => !t.offTrack).sort((a,b) => b.total - a.total);
      const leader = onTrack[0];
      const lastArchive = (state.roundArchive || []).slice().sort((a,b) => (b.roundNo || 0) - (a.roundNo || 0))[0];
      const lastChange = state.history?.[0];
      const moved = Object.values(state.round?.moved || {}).filter(Boolean).length;
      mount.innerHTML = `
        <div class="enhGrid">
          <div class="enhCard">
            <div class="enhValue">${state.round?.number ?? 1}</div>
            <div class="enhLabel">Aktualni kolo</div>
          </div>
          <div class="enhCard">
            <div class="enhValue">${leader ? leader.name : "—"}</div>
            <div class="enhLabel">Prubezny leader</div>
          </div>
          <div class="enhCard">
            <div class="enhValue">${moved}/5</div>
            <div class="enhLabel">Zadano v aktualnim kole</div>
          </div>
          <div class="enhCard">
            <div class="enhValue">${(state.round?.eventQueue || []).length}</div>
            <div class="enhLabel">Cekajici eventy</div>
          </div>
        </div>
        <div class="enhCard" style="margin-top:12px;">
          <h3>Rychly prehled</h3>
          <div class="enhMuted">Posledni zmena: ${lastChange ? `${lastChange.teamName || "—"} • ${(lastChange.event?.title || lastChange.source || "zmena")}` : "zatim bez zmen"}</div>
          <div class="enhMuted" style="margin-top:6px;">Posledni potvrzene kolo: ${lastArchive ? `${lastArchive.roundNo}. ${lastArchive.activityName || "bez nazvu"}` : "zatim zadne"}</div>
          <div class="enhButtonRow">
            <button class="btnSmall" data-enh-action="toggle-animations">${state.settings?.animationsEnabled === false ? "Zapnout animace" : "Vypnout animace"}</button>
            <button class="btnSmall" data-enh-action="jump-current">Skok na aktualni kolo</button>
          </div>
        </div>
      `;
    }

    function renderBatch(state){
      const mount = document.getElementById("enhBatchPanel");
      if (!mount) return;
      defaultDraftFromState(state);
      const teams = state.teams.slice().sort((a,b) => {
        const pa = parseInt(ui.draftPlacements[a.id], 10) || 99;
        const pb = parseInt(ui.draftPlacements[b.id], 10) || 99;
        return pa - pb || a.name.localeCompare(b.name);
      });
      const preview = app.buildBatchRoundPreview(ui.draftPlacements);
      mount.innerHTML = `
        <div class="enhSplit">
          <div>
            <div class="enhToolbar">
              <div style="flex:1 1 220px;">
                <div class="enhMuted">Nazev hry / aktivity</div>
                <input id="enhActivityName" type="text" value="${escapeHtml(ui.draftActivityName)}" placeholder="Napriklad Diskgolf, Stavba trate..." />
              </div>
              <button class="btnSmall" data-enh-action="auto-rank">Vyplnit 1-5 dle seznamu</button>
              <button class="btnOk" data-enh-action="apply-batch">Zadat cele kolo</button>
            </div>
            <div class="enhMuted" style="margin:8px 0 10px;">Pretahni tymy pro rychle poradi, nebo rucne uprav misto. Stejne misto lze pouzit pro remizu.</div>
            <div class="enhTeamDraft" id="enhDraftList">
              ${teams.map(team => `
                <div class="enhDraftRow" draggable="true" data-team-id="${team.id}">
                  <div class="enhGrip">≡</div>
                  <div><span class="enhDot" style="background:${team.color};"></span><strong>${escapeHtml(team.name)}</strong></div>
                  <select data-enh-place="${team.id}">
                    ${[1,2,3,4,5].map(place => `<option value="${place}" ${parseInt(ui.draftPlacements[team.id], 10) === place ? "selected" : ""}>${place}. misto</option>`).join("")}
                  </select>
                </div>
              `).join("")}
            </div>
          </div>
          <div>
            <div class="enhPreviewItem">
              <h3>Nahled kola</h3>
              ${preview.ok ? `
                <div class="enhMuted">Poradi po aplikaci posunu a preview kolizi:</div>
                <ol class="enhCompactList">
                  ${preview.standings.map(item => `<li><strong>${escapeHtml(item.name)}</strong> • ${item.total} poli • kolo ${item.lap} • policko ${item.tile}</li>`).join("")}
                </ol>
                <div class="enhMuted" style="margin-top:8px;">Kolize: ${preview.collisions.length ? "" : "zadne"}</div>
                <div class="enhPreviewList">
                  ${preview.collisions.map(col => `<div class="enhPreviewItem"><strong>${escapeHtml(col.a)}</strong> × <strong>${escapeHtml(col.b)}</strong> na poli ${col.tile} • ${escapeHtml(col.resolution)} • preview favorizuje: ${escapeHtml(col.previewWinner)}</div>`).join("")}
                </div>
                <div class="enhMuted" style="margin-top:8px;">Event triggery po uzavreni kola:</div>
                <div class="enhPreviewList">
                  ${preview.eventTiles.length ? preview.eventTiles.map(ev => `<div class="enhPreviewItem">${escapeHtml(ev.name)} • event pole ${ev.tile}</div>`).join("") : `<div class="enhPreviewItem">Po tomto kole se nespusti zadny event trigger.</div>`}
                </div>
              ` : `
                <div class="enhPreviewItem">${preview.issues.map(issue => escapeHtml(issue)).join("<br />")}</div>
              `}
            </div>
          </div>
        </div>
      `;
    }

    function renderHistory(state){
      const mount = document.getElementById("enhHistoryPanel");
      if (!mount) return;
      const archive = (state.roundArchive || []).slice().sort((a,b) => (b.roundNo || 0) - (a.roundNo || 0));
      mount.innerHTML = `
        <div class="enhHistoryList">
          ${archive.length ? archive.map(item => `
            <div class="enhHistoryItem">
              <div class="enhHistoryHead">
                <div>
                  <strong>${item.roundNo}. ${escapeHtml(item.activityName || "Bez nazvu")}</strong>
                  <div class="enhMuted">Kolize: ${(item.collisions || []).length} • eventy: ${(item.resolvedEvents || []).length}</div>
                </div>
                <div class="enhButtonRow" style="margin-top:0;">
                  <button class="btnSmall" data-enh-history="restore" data-round="${item.roundNo}">Obnovit stav</button>
                  <button class="btnSmall" data-enh-history="edit" data-round="${item.roundNo}">Upravit odtud</button>
                  <button class="btnDanger" data-enh-history="delete" data-round="${item.roundNo}">Smazat kolo</button>
                </div>
              </div>
              <div class="enhMuted" style="margin-top:8px;">${Object.entries(item.placements || {}).sort((a,b) => a[1] - b[1]).map(([teamId, place]) => {
                const team = state.teams.find(t => t.id === teamId);
                return `${place}. ${team ? team.name : teamId}`;
              }).join(" • ")}</div>
            </div>
          `).join("") : `<div class="enhHistoryItem">Historie potvrzenych kol zatim neobsahuje zadny zaznam.</div>`}
        </div>
      `;
    }

    function renderEvents(state){
      const mount = document.getElementById("enhEventsPanel");
      if (!mount) return;
      const rules = state.settings?.eventRules || {};
      mount.innerHTML = `
        <div class="enhEventList">
          ${Object.entries(app.eventsCatalog).map(([bucket, events]) => `
            <div class="enhEventItem">
              <div class="enhEventHead">
                <strong>${bucket}</strong>
                <span class="enhTag">${events.length} eventu</span>
              </div>
              <div class="enhEventList" style="margin-top:8px;">
                ${events.map(ev => {
                  const rule = rules[ev.key] || {};
                  const tiles = Array.isArray(rule.tiles) && rule.tiles.length ? rule.tiles.join(",") : "";
                  return `
                    <div class="enhEventItem">
                      <div class="enhEventHead">
                        <div>
                          <strong>${escapeHtml(ev.title)}</strong>
                          <div class="enhMuted">${escapeHtml(ev.text || ev.kind || "")}</div>
                        </div>
                        <label class="enhTag"><input type="checkbox" data-enh-event-enabled="${ev.key}" ${rule.enabled === false ? "" : "checked"} /> aktivni</label>
                      </div>
                      <div class="enhTwoCol" style="margin-top:8px;">
                        <div>
                          <div class="enhMuted">Vaha losu</div>
                          <input type="number" min="0" max="10" step="0.1" data-enh-event-weight="${ev.key}" value="${rule.weight == null ? 1 : rule.weight}" />
                        </div>
                        <div>
                          <div class="enhMuted">Pole (csv, prazdne = dle globalnich event poli)</div>
                          <input type="text" data-enh-event-tiles="${ev.key}" value="${escapeHtml(tiles)}" placeholder="napr. 8,18,28" />
                        </div>
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }

    function renderSettings(state){
      const mount = document.getElementById("enhSettingsPanel");
      if (!mount) return;
      const placeMap = state.settings?.placeToDelta || {};
      mount.innerHTML = `
        <div class="enhSettingsList">
          <div class="enhSettingRow">
            <h3>Nastaveni zavodu</h3>
            <div class="enhMuted" style="margin-bottom:10px;">Bodovani urcuje, o kolik poli se tym posune za 1.-5. misto. Rychlost animaci meni delku animace kolizi. Prepinac 60:40 kolize zapina pravdepodobnostni vyhodnoceni ve prospech predjizdejiciho, jinak vzdy postupuje predjizdejici. Animace zapnute povoluje vizualni prehrani kolizi.</div>
            <div class="enhTwoCol">
              <div>
                <div class="enhMuted">Nazev velke ceny</div>
                <input id="enhRaceName" type="text" value="${escapeHtml(state.settings?.raceName || "")}" />
              </div>
              <div>
                <div class="enhMuted">Aktualni kolo</div>
                <input id="enhRoundNumber" type="number" min="1" value="${state.round?.number || 1}" />
              </div>
              <div>
                <div class="enhMuted">Pocet poli trati</div>
                <input id="enhTrackSize" type="number" min="20" max="120" value="${state.settings?.trackSize || 40}" />
              </div>
              <div>
                <div class="enhMuted">Event pole (csv)</div>
                <input id="enhEventTiles" type="text" value="${escapeHtml((state.settings?.eventTiles || []).join(","))}" />
              </div>
              <div>
                <div class="enhMuted">1. misto</div>
                <input id="enhPlace1" type="number" value="${placeMap[1] ?? 5}" />
              </div>
              <div>
                <div class="enhMuted">2. misto</div>
                <input id="enhPlace2" type="number" value="${placeMap[2] ?? 4}" />
              </div>
              <div>
                <div class="enhMuted">3. misto</div>
                <input id="enhPlace3" type="number" value="${placeMap[3] ?? 3}" />
              </div>
              <div>
                <div class="enhMuted">4. misto</div>
                <input id="enhPlace4" type="number" value="${placeMap[4] ?? 2}" />
              </div>
              <div>
                <div class="enhMuted">5. misto</div>
                <input id="enhPlace5" type="number" value="${placeMap[5] ?? 1}" />
              </div>
              <div>
                <div class="enhMuted">Rychlost animaci</div>
                <input id="enhAnimSpeed" type="number" min="0.5" max="3" step="0.1" value="${state.settings?.animationSpeed || 1}" />
              </div>
            </div>
            <div class="enhButtonRow">
              <label class="enhTag"><input id="enhCollisionRandom" type="checkbox" ${state.settings?.collisionRandom === false ? "" : "checked"} /> 60:40 kolize</label>
              <label class="enhTag"><input id="enhAnimationsEnabled" type="checkbox" ${state.settings?.animationsEnabled === false ? "" : "checked"} /> animace zapnute</label>
              <button class="btnOk" data-enh-action="save-settings">Ulozit nastaveni</button>
            </div>
          </div>
          <div class="enhSettingRow">
            <h3>Tymy</h3>
            <div class="enhSettingsTeams">
              ${state.teams.map(team => `
                <div class="enhSettingsTeam">
                  <input type="text" data-enh-team-name="${team.id}" value="${escapeHtml(team.name)}" />
                  <input type="color" data-enh-team-color="${team.id}" value="${escapeHtml(team.color)}" />
                </div>
              `).join("")}
            </div>
          </div>
        </div>
      `;
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

    function renderShell(){
      if (!ensureMounts()) return;
      const adminMount = document.getElementById("enhAdminPanels");
      if (!adminMount) return;
      adminMount.innerHTML = `
        <section class="enhPanel">
          <h3>Admin dashboard</h3>
          <div id="enhDashboard"></div>
        </section>
        <section class="enhPanel">
          <h3>Rychle zadani kola</h3>
          <div id="enhBatchPanel"></div>
        </section>
        <section class="enhPanel">
          <h3>Historie kol</h3>
          <div id="enhHistoryPanel"></div>
        </section>
        <section class="enhPanel">
          <h3>Sprava eventu</h3>
          <div id="enhEventsPanel"></div>
        </section>
        <section class="enhPanel">
          <h3>Nastaveni a rychle zasahy</h3>
          <div id="enhSettingsPanel"></div>
        </section>
      `;
    }

    function refresh(){
      if (!ensureMounts()) return;
      renderShell();
      const state = getState();
      defaultDraftFromState(state);
      renderDashboard(state);
      renderBatch(state);
      renderHistory(state);
      renderEvents(state);
      renderSettings(state);
      renderPublicPanelV2(state);
    }

    function applySettings(){
      const state = getState();
      state.settings = state.settings || {};
      state.settings.raceName = document.getElementById("enhRaceName")?.value?.trim() || state.settings.raceName;
      state.settings.trackSize = parseInt(document.getElementById("enhTrackSize")?.value, 10) || state.settings.trackSize;
      state.settings.eventTiles = String(document.getElementById("enhEventTiles")?.value || "").split(",").map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
      state.settings.placeToDelta = {
        1: parseInt(document.getElementById("enhPlace1")?.value, 10) || 5,
        2: parseInt(document.getElementById("enhPlace2")?.value, 10) || 4,
        3: parseInt(document.getElementById("enhPlace3")?.value, 10) || 3,
        4: parseInt(document.getElementById("enhPlace4")?.value, 10) || 2,
        5: parseInt(document.getElementById("enhPlace5")?.value, 10) || 1
      };
      state.settings.collisionRandom = !!document.getElementById("enhCollisionRandom")?.checked;
      state.settings.animationsEnabled = !!document.getElementById("enhAnimationsEnabled")?.checked;
      state.settings.animationSpeed = parseFloat(document.getElementById("enhAnimSpeed")?.value || "1") || 1;
      state.round.number = Math.max(1, parseInt(document.getElementById("enhRoundNumber")?.value, 10) || state.round.number || 1);
      state.teams = state.teams.map(team => ({
        ...team,
        name: document.querySelector(`[data-enh-team-name="${team.id}"]`)?.value?.trim() || team.name,
        color: document.querySelector(`[data-enh-team-color="${team.id}"]`)?.value || team.color
      }));
      app.setState(state);
      app.showToast("Nastaveni ulozeno.");
    }

    function updateEventRule(key, patch){
      const state = getState();
      state.settings = state.settings || {};
      state.settings.eventRules = state.settings.eventRules || {};
      state.settings.eventRules[key] = {
        ...(state.settings.eventRules[key] || {}),
        ...patch
      };
      app.setState(state);
    }

    function handleHistory(action, roundNo){
      const state = getState();
      const archive = (state.roundArchive || []).find(item => Number(item.roundNo) === Number(roundNo));
      if (!archive) return;
      if (action === "restore" && archive.endSnapshot) {
        app.restoreSnapshot(archive.endSnapshot);
        app.showToast(`Obnoven stav po kole ${roundNo}.`);
        return;
      }
      if (!archive.startSnapshot) return;
      app.restoreSnapshot(archive.startSnapshot);
      if (action === "edit") {
        ui.draftPlacements = { ...(archive.placements || {}) };
        ui.draftActivityName = archive.activityName || "";
        app.showToast(`Kolo ${roundNo} pripraveno k nove editaci.`);
      } else if (action === "delete") {
        ui.draftPlacements = {};
        ui.draftActivityName = "";
        app.showToast(`Kolo ${roundNo} bylo odriznuto a navazujici kola se otevrela k novemu prepocitani.`);
      }
      refresh();
    }

    document.addEventListener("change", function(event){
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.matches("[data-enh-place]")) {
        ui.draftPlacements[target.getAttribute("data-enh-place")] = parseInt(target.value, 10);
        refresh();
        return;
      }

      if (target.matches("[data-enh-event-enabled]")) {
        updateEventRule(target.getAttribute("data-enh-event-enabled"), { enabled: !!target.checked });
        return;
      }

      if (target.matches("[data-enh-event-weight]")) {
        updateEventRule(target.getAttribute("data-enh-event-weight"), { weight: parseFloat(target.value || "1") || 1 });
        return;
      }

      if (target.matches("[data-enh-event-tiles]")) {
        updateEventRule(target.getAttribute("data-enh-event-tiles"), {
          tiles: String(target.value || "").split(",").map(x => parseInt(x.trim(), 10)).filter(Number.isFinite)
        });
      }
    });

    document.addEventListener("input", function(event){
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.id === "enhActivityName") ui.draftActivityName = target.value;
    });

    document.addEventListener("click", function(event){
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const actionEl = target.closest("[data-enh-action]");
      if (actionEl) {
        const action = actionEl.getAttribute("data-enh-action");
        if (action === "auto-rank") {
          const rows = [...document.querySelectorAll(".enhDraftRow")];
          rows.forEach((row, index) => {
            ui.draftPlacements[row.getAttribute("data-team-id")] = index + 1;
          });
          refresh();
        }
        if (action === "apply-batch") {
          const validation = app.applyBatchRound(ui.draftPlacements, ui.draftActivityName);
          if (validation?.ok) app.showToast("Kolo zapsano hromadne. Dokonci potvrzeni v rekapitulaci.");
        }
        if (action === "apply-kids-batch") {
          const validation = app.applyBatchRound(ui.draftPlacements, ui.draftActivityName);
          if (validation?.ok) app.showToast("Poradi zadano. Dokonci potvrzeni kola.");
        }
        if (action === "save-settings") applySettings();
        if (action === "toggle-animations") {
          const state = getState();
          state.settings.animationsEnabled = !(state.settings?.animationsEnabled !== false);
          app.setState(state);
        }
        if (action === "jump-current") {
          const field = document.getElementById("enhRoundNumber");
          if (field) field.focus();
        }
      }

      const historyEl = target.closest("[data-enh-history]");
      if (historyEl) handleHistory(historyEl.getAttribute("data-enh-history"), historyEl.getAttribute("data-round"));
    });

    document.addEventListener("dragstart", function(event){
      const row = event.target.closest(".enhDraftRow, .kidsDraftTeam");
      if (!row) return;
      ui.dragTeamId = row.getAttribute("data-team-id") || row.getAttribute("data-kids-team");
      row.classList.add("dragging");
    });

    document.addEventListener("dragend", function(event){
      const row = event.target.closest(".enhDraftRow, .kidsDraftTeam");
      if (!row) return;
      row.classList.remove("dragging");
      ui.dragTeamId = null;
      document.querySelectorAll(".kidsDraftSlot").forEach(el => el.classList.remove("drag-over"));
    });

    document.addEventListener("dragover", function(event){
      const row = event.target.closest(".enhDraftRow");
      const slot = event.target.closest(".kidsDraftSlot");
      if ((!row && !slot) || !ui.dragTeamId) return;
      event.preventDefault();
      if (slot) slot.classList.add("drag-over");
    });

    document.addEventListener("drop", function(event){
      const row = event.target.closest(".enhDraftRow");
      const slot = event.target.closest(".kidsDraftSlot");
      if ((!row && !slot) || !ui.dragTeamId) return;
      event.preventDefault();
      document.querySelectorAll(".kidsDraftSlot").forEach(el => el.classList.remove("drag-over"));
      let nextOrder;
      if (row) {
        const targetTeamId = row.getAttribute("data-team-id");
        if (!targetTeamId || targetTeamId === ui.dragTeamId) return;
        const rows = [...document.querySelectorAll(".enhDraftRow")].map(el => el.getAttribute("data-team-id"));
        nextOrder = rows.filter(id => id !== ui.dragTeamId);
        nextOrder.splice(nextOrder.indexOf(targetTeamId), 0, ui.dragTeamId);
        nextOrder.forEach((teamId, index) => {
          ui.draftPlacements[teamId] = index + 1;
        });
      } else {
        const place = parseInt(slot.getAttribute("data-kids-slot"), 10);
        if (![1,2,3,4,5].includes(place)) return;
        ui.draftPlacements[ui.dragTeamId] = place;
      }
      refresh();
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
