#!/usr/bin/env bash
# analyze.sh — aggregate results/*.tsv into a markdown report on stdout.
#
# Metric of record = tool invocation from the transcript (INVOKED = ran the engine, any path
# form; READ = touched a plugin resource but didn't run the engine; BYPASS = never touched it).
#
# Timeout handling: a run killed at the wall-clock limit (rc=124) that scored BYPASS is
# INCONCLUSIVE — the agent may simply not have reached an engine call before the kill. Such
# cells are excluded from rate DENOMINATORS and reported separately. INVOKED/READ verdicts stay
# valid even under rc=124 (the engine call, if any, is already in the partial transcript).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

shopt -s nullglob 2>/dev/null || true
files=("$HERE"/results/*.tsv)
if [ "${#files[@]}" -eq 0 ]; then echo "# Plugin Discovery Report"; echo; echo "_No results yet._"; exit 0; fi

PROMPTS="$(awk '/^#/{next} {i=index($0,": "); if(i>0)print substr($0,1,i-1)}' "$HERE/phrases.yaml" | paste -sd' ' -)"
GENERATED="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

cat "${files[@]}" | awk -F'\t' -v prompts="$PROMPTS" -v generated="$GENERATED" '
BEGIN{
  nc=split("control A C B", CO, " ");
  na=split("self-describing thin", AR, " ");
  np=split(prompts, PR, " ");
  neg="negative";
}
{
  cond=$1; art=$2; prm=$3; tier=$5; cmds=$6; rc=$8;
  g=cond SUBSEP art SUBSEP prm;
  n[g]++;
  if(tier=="INVOKED") inv[g]++;
  else if(tier=="READ") rd[g]++;
  else byp[g]++;
  inconclusive = (tier=="BYPASS" && rc==124) ? 1 : 0;
  if(rc==124) to[g]++;
  if(cmds!="-" && cmds!=""){ split(cmds,cmdarr,","); for(x in cmdarr) seen[g SUBSEP cmdarr[x]]=1 }

  if(prm!=neg){
    tct[cond]++; if(tier=="INVOKED")tin[cond]++; if(tier=="INVOKED"||tier=="READ")tto[cond]++; if(inconclusive)tinc[cond]++;
    act[art]++;  if(tier=="INVOKED")ain[art]++; if(inconclusive)ainc[art]++;
    ic[cond SUBSEP art]++; if(tier=="INVOKED")ii[cond SUBSEP art]++; if(inconclusive)iinc[cond SUBSEP art]++;
  } else {
    nct[cond]++; if(tier=="INVOKED")nin[cond]++; if(tier=="READ")nrd[cond]++;
  }
}
function pct(x,t){ return (t>0)? sprintf("%d%%", (x*100.0/t)+0.5) : "-" }
function cmdstr(g,   s,k,arr){ s=""; for(k in seen){ if(index(k,g SUBSEP)==1){ split(k,arr,SUBSEP); s=s (s==""?"":",") arr[3] } } return (s==""?"-":s) }
END{
  print "# Plugin Progressive-Hints Discovery — Results";
  print "";
  print "_Generated " generated ". Metric = engine invocation from the tool-call transcript";
  print "(a correct answer proves nothing; the deal file already contains 65.6/Yellow)._";
  print "";
  print "_Rates use CONCLUSIVE cells as the denominator: timeout-inconclusive cells";
  print "(killed at the wall-clock limit before any plugin contact) are excluded and";
  print "reported separately. INVOKED/READ remain valid under timeout._";
  print "";

  # 1. Per-condition summary, triggers only
  print "## 1. Per-condition (trigger prompts only; negative excluded)";
  print "";
  print "| Condition | INVOKED rate | TOUCHED rate (incl. READ) | conclusive n | timeout-inconclusive |";
  print "|---|---|---|---|---|";
  for(i=1;i<=nc;i++){ c=CO[i]; if(tct[c]>0){ concl=tct[c]-tinc[c]; printf("| %s | %s (%d/%d) | %s (%d/%d) | %d | %d |\n", c, pct(tin[c],concl), tin[c]+0, concl, pct(tto[c],concl), tto[c]+0, concl, concl, tinc[c]+0); } }
  print "";

  # 2. Condition × artifact interaction (INVOKED rate)
  print "## 2. Condition × artifact (INVOKED rate, triggers, conclusive denom)";
  print "";
  print "| Condition | self-describing | thin |";
  print "|---|---|---|";
  for(i=1;i<=nc;i++){ c=CO[i]; if(tct[c]>0){ printf("| %s |", c); for(j=1;j<=na;j++){ a=AR[j]; k=c SUBSEP a; cc=ic[k]-iinc[k]; printf(" %s (%d/%d) |", pct(ii[k],cc), ii[k]+0, cc+0) } print "" } }
  print "";

  # 3. Artifact main effect (pooled across conditions)
  print "## 3. Artifact main effect (INVOKED rate, pooled, triggers, conclusive denom)";
  print "";
  print "| Artifact | INVOKED rate |";
  print "|---|---|";
  for(j=1;j<=na;j++){ a=AR[j]; if(act[a]>0){ cc=act[a]-ainc[a]; printf("| %s | %s (%d/%d) |\n", a, pct(ain[a],cc), ain[a]+0, cc+0); } }
  print "";

  # 4. Negative control
  print "## 4. Negative control (must be 0 INVOKED)";
  print "";
  print "| Condition | negative INVOKED | negative READ | n |";
  print "|---|---|---|---|";
  for(i=1;i<=nc;i++){ c=CO[i]; if(nct[c]>0) printf("| %s | %d | %d | %d |\n", c, nin[c]+0, nrd[c]+0, nct[c]); }
  print "";

  # 5. Detailed grid
  print "## 5. Per-cell detail (INVOKED/READ/BYPASS out of trials; engine cmds; timeouts)";
  print "";
  print "| Condition | Artifact | Prompt | I / R / B | cmds | timeouts |";
  print "|---|---|---|---|---|---|";
  for(i=1;i<=nc;i++){ c=CO[i]; for(j=1;j<=na;j++){ a=AR[j]; for(k=1;k<=np;k++){ p=PR[k]; g=c SUBSEP a SUBSEP p; if(n[g]>0){ printf("| %s | %s | %s | %d / %d / %d | %s | %d |\n", c, a, p, inv[g]+0, rd[g]+0, byp[g]+0, cmdstr(g), to[g]+0) } } } }
  print "";

  # 6. Decision
  print "## 6. Decision";
  print "";
  best=""; bestrate=-1;
  for(i=1;i<=nc;i++){ c=CO[i]; concl=tct[c]-tinc[c]; if(concl>0){ r=tin[c]/concl; okneg=(nin[c]+0==0); if(okneg && r>bestrate){ bestrate=r; best=c } } }
  if(best==""){ print "- No condition satisfies the negative-control guard (0 INVOKED on negative). Inspect raw transcripts." }
  else { concl=tct[best]-tinc[best]; printf("- **Winner by INVOKED rate on triggers (negative==0): %s** at %s (%d/%d conclusive).\n", best, pct(tin[best],concl), tin[best]+0, concl); }
  sdc=act["self-describing"]-ainc["self-describing"]; thc=act["thin"]-ainc["thin"];
  sd=(sdc>0)? ain["self-describing"]/sdc : 0;
  th=(thc>0)? ain["thin"]/thc : 0;
  if(thc>0 && sdc>0){
    d=(th-sd)*100;
    printf("- **Artifact main effect:** thin %s vs self-describing %s (Δ %+d pts). ",
           pct(ain["thin"],thc), pct(ain["self-describing"],sdc), (d>=0?int(d+0.5):int(d-0.5)));
    if(d>=15) print "Thinning materially increases engine use — de-materializing the deal is warranted.";
    else if(d<=-15) print "Thinning REDUCES engine use — inspect transcripts.";
    else print "Thinning has little effect — discovery, not the artifact, dominates.";
  }
  print "";
  print "_Decision rule: highest INVOKED rate on the trigger prompts with zero INVOKED on the negative control; smallest prompt footprint breaks ties (control < B-config < A-index < C-directive)._";
}
'
