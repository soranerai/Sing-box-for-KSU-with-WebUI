#!/system/bin/sh
# stat_daemon.sh
# Collects stats from sing-box REST API. Writes to webroot for direct fetch access.

MOD_PATH="/data/adb/modules/singbox_ksu"
STATS_FILE="$MOD_PATH/webroot/stats.log"

TOKEN=$(cat "$MOD_PATH/.metadata.json" 2>/dev/null | grep -o '"token":"[^"]*"' | cut -d'"' -f4 | head -n1)

LAST_UP=0
LAST_DOWN=0
LAST_TS=0

# Clean start
echo "" > "$STATS_FILE"

while true; do
  JSON=$(busybox wget -qO- http://127.0.0.1:9090/connections?token=$TOKEN 2>/dev/null)
  
  if [ -n "$JSON" ]; then
    NOW=$(date +%s)
    
    UP_TOTAL=$(echo "$JSON" | sed -n 's/.*"uploadTotal":\([0-9]*\).*/\1/p')
    DOWN_TOTAL=$(echo "$JSON" | sed -n 's/.*"downloadTotal":\([0-9]*\).*/\1/p')
    MEM=$(echo "$JSON" | sed -n 's/.*"memory":\([0-9]*\).*/\1/p')
    CONNS=$(echo "$JSON" | grep -o '"id":' | wc -l)
    
    # Calculate speeds
    if [ "$LAST_TS" -gt 0 ]; then
      INTERVAL=$((NOW - LAST_TS))
      [ "$INTERVAL" -le 0 ] && INTERVAL=1
      
      UP_SPEED=$(( (UP_TOTAL - LAST_UP) / INTERVAL ))
      DOWN_SPEED=$(( (DOWN_TOTAL - LAST_DOWN) / INTERVAL ))
      
      # Save all in one line
      echo "{\"ts\":$NOW,\"up\":$UP_SPEED,\"down\":$DOWN_SPEED,\"conn\":$CONNS,\"mem\":$MEM}" >> "$STATS_FILE"
    fi
    
    LAST_UP=$UP_TOTAL
    LAST_DOWN=$DOWN_TOTAL
    LAST_TS=$NOW
  fi
  
  # Rotation: keep only last 5 minutes (300 lines at ~1s interval)
  if [ $((NOW % 30)) -eq 0 ]; then
    busybox tail -n 300 "$STATS_FILE" > "$STATS_FILE.tmp" 2>/dev/null
    mv -f "$STATS_FILE.tmp" "$STATS_FILE" 2>/dev/null
  fi

  sleep 1
done
