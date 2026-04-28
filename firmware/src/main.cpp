#include <Arduino.h>
#include "AudioAnalyzer.h"

AudioAnalyzer audio;

void setup() {
    Serial.begin(921600); // Teleplot communication speed
    audio.begin();
}

void loop() {
    if (audio.dataReady) {
        audio.stopTimer(); // Stop the timer to prevent new data from being collected while processing
        audio.computeFFT(); // Compute the FFT when data is ready
        audio.sendToTeleplot(); // Send the FFT results to Teleplot
        audio.dataReady = false; // Reset the flag after processing
        audio.startTimer();  // Resume sampling
    }
}