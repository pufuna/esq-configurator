L=""
for wh in "2450 2537" "2450 2767" "2450 2813"; do
  set -- $wh; W=$1; H=$2
  python3 g1.py $W $H 0 >/dev/null; L="$L out_r/R_G1_${W}_${H}_0.svg"
  for c in S R SR; do python3 compose_r.py R_G1_${W}_${H}_0 $c --bypass-drawn --body-h 2099 >/dev/null || echo FAIL; L="$L out_r/R_G1_${W}_${H}_0_$c.svg"; done
  python3 g1.py $W $H B >/dev/null; L="$L out_r/R_G1_${W}_${H}_B.svg"
  python3 g1.py $W $H B --extras >/dev/null
  for c in S R SR; do python3 compose_r.py R_G1_${W}_${H}_B $c --bypass-drawn --body-h 2099 >/dev/null || echo FAIL; L="$L out_r/R_G1_${W}_${H}_B_$c.svg"; done
  python3 g1.py $W $H B >/dev/null
done
timeout 4000 python3 topdf.py $L | tail -1
ls out_r/R_G1_*.pdf | wc -l
echo DONE
