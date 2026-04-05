#ifndef LED_DRIVER_H
#define LED_DRIVER_H

#include <Arduino.h>
#include "AudioAnalyzer.h"

class LEDDriver {
	private:
		uint8_t dataPin;
		uint8_t clockPin;
		uint8_t latchPin;
		static constexpr float logScale = 7.0f;

		uint8_t outputState;
		uint32_t lowPeakHoldUntil;
		uint32_t highPeakHoldUntil;

		void writeOutputs(uint8_t value) {
			digitalWrite(latchPin, LOW);
			shiftOut(dataPin, clockPin, LSBFIRST, value);
			digitalWrite(latchPin, HIGH);
		}

		float logAverage(const AudioAnalyzer &audio, int startBin, int endBin) const {
			float sum = 0.0f;
			float weightSum = 0.0f;

			for (int i = startBin; i <= endBin; i++) {
				float magnitude = (float)audio.getMagnitude(i);
				if (magnitude < 0.0f) {
					magnitude = 0.0f;
				}

				float weight = log10f((float)(i - startBin + 2));
				float compressed = log10f(1.0f + magnitude);
				sum += compressed * weight;
				weightSum += weight;
			}

			if (weightSum <= 0.0f) {
				return 0.0f;
			}

			return sum / weightSum;
		}

		float bandLevel(const AudioAnalyzer &audio, int startBin, int endBin) const {
			float value = logAverage(audio, startBin, endBin);
			return constrain(value / logScale, 0.0f, 1.0f);
		}

		void applyGroup(uint8_t green1Bit, uint8_t green2Bit, uint8_t green3Bit, uint8_t peakBit, float level, uint32_t now, uint32_t &peakHoldUntil) {
			if (level > 0.18f) {
				outputState |= (1 << green1Bit);
			}
			if (level > 0.40f) {
				outputState |= (1 << green2Bit);
			}
			if (level > 0.65f) {
				outputState |= (1 << green3Bit);
			}
			if (level > 0.85f) {
				peakHoldUntil = now + 120;
			}
			if (now < peakHoldUntil) {
				outputState |= (1 << peakBit);
			}
		}

	public:
		LEDDriver(uint8_t dataPin = 4, uint8_t clockPin = 5, uint8_t latchPin = 6) {
			this->dataPin = dataPin;
			this->clockPin = clockPin;
			this->latchPin = latchPin;
			outputState = 0;
			lowPeakHoldUntil = 0;
			highPeakHoldUntil = 0;
		}

		void begin() {
			pinMode(dataPin, OUTPUT);
			pinMode(clockPin, OUTPUT);
			pinMode(latchPin, OUTPUT);
			digitalWrite(latchPin, LOW);
			writeOutputs(0);
		}

		void startupSequence() {
			outputState = 0;
			writeOutputs(0);
			delay(80);

			for (int bit = 0; bit < 8; bit++) {
				outputState |= (1 << bit);
				writeOutputs(outputState);
				delay(45);
			}

			for (int bit = 7; bit >= 0; bit--) {
				outputState &= ~(1 << bit);
				writeOutputs(outputState);
				delay(35);
			}

			outputState = 0;
			writeOutputs(0);
		}

		void update(const AudioAnalyzer &audio) {
			uint32_t now = millis();

			float lowLevel = bandLevel(audio, 1, 42);
			float highLevel = bandLevel(audio, 43, 126);

			outputState = 0;
			applyGroup(7, 6, 5, 4, lowLevel, now, lowPeakHoldUntil);   // Q_E to Q_H = low sounds
			applyGroup(3, 2, 1, 0, highLevel, now, highPeakHoldUntil); // Q_A to Q_D = high sounds

			writeOutputs(outputState);
		}
};

#endif // LED_DRIVER_H
