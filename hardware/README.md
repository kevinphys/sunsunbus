# 硬體感測盒

手機量測的對照組。格式與對時方式見 [`docs/hardware-format.md`](../docs/hardware-format.md)。

- `esp32_imu_logger/`：ESP32 + MPU6050 + microSD 的 Arduino 範例（100 Hz，按 BOOT 鍵開始／結束）。
  **尚未在實機上編譯測試**，請硬體組員燒錄後先在桌上靜置錄 10 秒，確認 `az ≈ 9.8`、其餘接近 0。
- 改用 BMI270 等其他 IMU：替換 `mpuInit()` 與 `mpuRead()`，輸出單位維持 m/s²（含重力）與 deg/s。
- 想用 BLE 傳到手機而不是寫 SD 卡：保持相同的 CSV 欄位即可，分析工具只看檔案格式。

## 上車使用

1. 盒子用束帶或雙面膠**牢牢固定**在座椅骨架或扶手底座（不要放在會滑動的地方）。
2. 按 BOOT 鍵開始記錄（LED 亮）。
3. 手機按「上車開始」，再按「🔔 對時敲擊」，把手機疊在盒子上一起敲一下桌面或椅背硬處。
4. 手機放回支架。下車時兩邊各自結束。
5. 分析：`uv run sunsunbus compare-box data/<手機趟次> data/box_0001.csv`
