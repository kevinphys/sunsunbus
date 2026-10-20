// 順順行 sunsunbus 硬體感測盒範例韌體：ESP32 + MPU6050 + microSD
// 以約 100 Hz 記錄三軸加速度（含重力，m/s²）與陀螺儀（deg/s），格式見 docs/hardware-format.md。
//
// 接線（ESP32 DevKit 預設腳位）：
//   MPU6050  VCC→3V3  GND→GND  SDA→GPIO21  SCL→GPIO22
//   microSD  CS→GPIO5  SCK→GPIO18  MISO→GPIO19  MOSI→GPIO23  VCC→3V3（或 5V，看模組）
//   按鈕     GPIO0（板子上的 BOOT 鍵）：按一下開始／結束一個檔案
//   LED      GPIO2（板載 LED）：記錄中恆亮，寫入錯誤時快閃
//
// 不需要額外的 IMU 函式庫，直接讀寫 MPU6050 暫存器。
// 使用 Arduino IDE 的 "ESP32 Dev Module" 板型即可編譯。

#include <Wire.h>
#include <SPI.h>
#include <SD.h>

const uint8_t MPU_ADDR = 0x68;
const int PIN_SD_CS = 5;
const int PIN_BUTTON = 0;
const int PIN_LED = 2;
const uint32_t SAMPLE_US = 10000;  // 100 Hz
const float G = 9.80665f;
const float ACC_LSB_PER_G = 8192.0f;   // ±4 g
const float GYRO_LSB_PER_DPS = 65.5f;  // ±500 deg/s

File logFile;
bool recording = false;
uint32_t nextSampleUs = 0;
uint32_t lastFlushMs = 0;
uint32_t lastButtonMs = 0;

void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

bool mpuInit() {
  Wire.begin(21, 22);
  Wire.setClock(400000);
  Wire.beginTransmission(MPU_ADDR);
  if (Wire.endTransmission() != 0) return false;
  mpuWrite(0x6B, 0x00);  // PWR_MGMT_1：喚醒
  delay(50);
  mpuWrite(0x1A, 0x03);  // CONFIG：內建數位低通約 44 Hz（去掉高頻震動，保留公車加減速）
  mpuWrite(0x19, 0x09);  // SMPLRT_DIV：1 kHz / (1 + 9) = 100 Hz
  mpuWrite(0x1B, 0x08);  // GYRO_CONFIG：±500 deg/s
  mpuWrite(0x1C, 0x08);  // ACCEL_CONFIG：±4 g
  return true;
}

bool mpuRead(float acc[3], float gyro[3]) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)MPU_ADDR, 14) != 14) return false;
  int16_t raw[7];
  for (int i = 0; i < 7; i++) raw[i] = (Wire.read() << 8) | Wire.read();
  for (int i = 0; i < 3; i++) acc[i] = raw[i] / ACC_LSB_PER_G * G;
  // raw[3] 是溫度，略過
  for (int i = 0; i < 3; i++) gyro[i] = raw[4 + i] / GYRO_LSB_PER_DPS;
  return true;
}

String nextFileName() {
  for (int i = 1; i < 10000; i++) {
    char name[20];
    snprintf(name, sizeof(name), "/box_%04d.csv", i);
    if (!SD.exists(name)) return String(name);
  }
  return String("/box_overflow.csv");
}

void startRecording() {
  String name = nextFileName();
  logFile = SD.open(name, FILE_WRITE);
  if (!logFile) {
    Serial.println("無法建立檔案");
    return;
  }
  logFile.println("# sunsunbus-box v1");
  logFile.println("# device=esp32-mpu6050 rate_hz=100 accel_range_g=4 gyro_range_dps=500");
  logFile.println("t_ms,ax,ay,az,gx,gy,gz");
  recording = true;
  nextSampleUs = micros();
  digitalWrite(PIN_LED, HIGH);
  Serial.printf("開始記錄 %s\n", name.c_str());
}

void stopRecording() {
  if (logFile) logFile.close();
  recording = false;
  digitalWrite(PIN_LED, LOW);
  Serial.println("停止記錄");
}

void blinkError() {
  for (int i = 0; i < 10; i++) {
    digitalWrite(PIN_LED, i % 2);
    delay(100);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  if (!mpuInit()) {
    Serial.println("找不到 MPU6050，請檢查接線");
    while (true) blinkError();
  }
  if (!SD.begin(PIN_SD_CS)) {
    Serial.println("SD 卡初始化失敗");
    while (true) blinkError();
  }
  Serial.println("就緒：按 BOOT 鍵開始／結束記錄");
}

void loop() {
  // 按鈕（去抖動 500 ms）
  if (digitalRead(PIN_BUTTON) == LOW && millis() - lastButtonMs > 500) {
    lastButtonMs = millis();
    if (recording) stopRecording();
    else startRecording();
  }
  if (!recording) return;

  if ((int32_t)(micros() - nextSampleUs) < 0) return;
  nextSampleUs += SAMPLE_US;

  float acc[3], gyro[3];
  if (!mpuRead(acc, gyro)) return;
  char line[96];
  snprintf(line, sizeof(line), "%lu,%.4f,%.4f,%.4f,%.3f,%.3f,%.3f", (unsigned long)millis(), acc[0], acc[1], acc[2], gyro[0], gyro[1], gyro[2]);
  logFile.println(line);

  // 每秒寫入一次，斷電最多遺失 1 秒
  if (millis() - lastFlushMs > 1000) {
    lastFlushMs = millis();
    logFile.flush();
  }
}
