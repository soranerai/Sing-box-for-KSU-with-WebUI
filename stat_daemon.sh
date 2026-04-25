#!/system/bin/sh
# stat_daemon.sh
# Collects stats from sing-box REST API. Writes to webroot for direct fetch access.

MOD_PATH="/data/adb/modules/singbox_ksu"
STATS_FILE="$MOD_PATH/webroot/stats.log"

TOKEN=$(cat "$MOD_PATH/.metadata.json" 2>/dev/null | grep -o '"token":"[^"]*"' | cut -d'"' -f4 | head -n1)

LAST_UP=0
LAST_DOWN=0
LAST_TS=0

LOGS_FILE="$MOD_PATH/webroot/logs.log"

# Clean start
echo "" > "$STATS_FILE"
echo "" > "$LOGS_FILE"
chmod 644 "$STATS_FILE" "$LOGS_FILE"

# Log collector in background
(
  while true; do
    (
      echo -ne "GET /logs?token=$TOKEN&level=info HTTP/1.1\r\n"
      echo -ne "Host: 127.0.0.1:9090\r\n"
      echo -ne "Upgrade: websocket\r\n"
      echo -ne "Connection: Upgrade\r\n"
      echo -ne "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
      echo -ne "Sec-WebSocket-Version: 13\r\n\r\n"
      while true; do sleep 3600; done
    ) | busybox nc 127.0.0.1 9090 | grep -ao '{"type":[^}]*}' | while read -r line; do
      [ -z "$line" ] && continue
      echo "{\"ts\":$(date +%s),${line#\{}" >> "$LOGS_FILE"
    done
    sleep 3
  done
) &

while true; do
  JSON=$(busybox wget -qO- http://127.0.0.1:9090/connections?token=$TOKEN 2>/dev/null)
  
  NOW=$(date +%s)
  if [ -n "$JSON" ]; then
    UP_TOTAL=$(echo "$JSON" | sed -n 's/.*"uploadTotal":\([0-9]*\).*/\1/p')
    DOWN_TOTAL=$(echo "$JSON" | sed -n 's/.*"downloadTotal":\([0-9]*\).*/\1/p')
    MEM=$(echo "$JSON" | sed -n 's/.*"memory":\([0-9]*\).*/\1/p')
    CONNS=$(echo "$JSON" | grep -o '"id":' | wc -l)
    
    # Calculate speeds
    if [ "$LAST_TS" -gt 0 ]; then
      INTERVAL=$((NOW - LAST_TS))
      [ "$INTERVAL" -le 0 ] && INTERVAL=1
      
      UP_DIFF=$((UP_TOTAL - LAST_UP))
      DOWN_DIFF=$((DOWN_TOTAL - LAST_DOWN))
      
      # Handle counter reset (restart)
      [ "$UP_DIFF" -lt 0 ] && UP_DIFF=0
      [ "$DOWN_DIFF" -lt 0 ] && DOWN_DIFF=0
      
      UP_SPEED=$(( UP_DIFF / INTERVAL ))
      DOWN_SPEED=$(( DOWN_DIFF / INTERVAL ))
      
      # Save all in one line
      echo "{\"ts\":$NOW,\"up\":$UP_SPEED,\"down\":$DOWN_SPEED,\"conn\":$CONNS,\"mem\":$MEM}" >> "$STATS_FILE"
    fi
    
    LAST_UP=$UP_TOTAL
    LAST_DOWN=$DOWN_TOTAL
    LAST_TS=$NOW
  fi
  
  # Rotation
  if [ $((NOW % 30)) -eq 0 ]; then
    # Stats: keep last 300 lines
    busybox tail -n 300 "$STATS_FILE" > "$STATS_FILE.tmp" 2>/dev/null
    chmod 644 "$STATS_FILE.tmp" 2>/dev/null
    mv -f "$STATS_FILE.tmp" "$STATS_FILE" 2>/dev/null

    # Logs: limit by size 5MB
    if [ -f "$LOGS_FILE" ]; then
      SIZE=$(wc -c < "$LOGS_FILE")
      if [ "$SIZE" -gt 5242880 ]; then
        # Keep last 1000 lines if over 5MB
        busybox tail -n 1000 "$LOGS_FILE" > "$LOGS_FILE.tmp" 2>/dev/null
        chmod 644 "$LOGS_FILE.tmp" 2>/dev/null
        mv -f "$LOGS_FILE.tmp" "$LOGS_FILE" 2>/dev/null
      fi
    fi
  fi

  sleep 1
done
