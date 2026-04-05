#include <Arduino.h>
#include "AudioAnalyzer.h"
#include "LEDDriver.h"

AudioAnalyzer audio;
LEDDriver leds;

void setup() {
    Serial.begin(921600); // Teleplot communication speed
    audio.begin();
    leds.begin();
    leds.startupSequence();
}

void loop() {
    //Serial.println(">test:10"); delay(1000);
    if (audio.dataReady) {
        audio.stopTimer(); // Stop the timer to prevent new data from being collected while processing
        audio.computeFFT(); // Compute the FFT when data is ready
        audio.sendToTeleplot(); // Send the FFT results to Teleplot
        leds.update(audio); // Update the 74HC595 LED outputs
        audio.dataReady = false; // Reset the flag after processing
        audio.startTimer();  // START the bartender again
    }
}