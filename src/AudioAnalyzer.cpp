#include "AudioAnalyzer.h"
#include "arduinoFFT.h"

hw_timer_t * timer = NULL; //Pointer to timer object
extern AudioAnalyzer audio; //External reference to the AudioAnalyzer instance
volatile int sampleIndex = 0; //Index for the current sample being recorded

AudioAnalyzer::AudioAnalyzer() {
    activeBuffer = 0;
    dataReady = false;
}   

void IRAM_ATTR onTimer() { //O(1)
    double sample = (double)analogRead(0)-2048.0; //Read the ADC value from pin 0 and center it around 0 (assuming 12-bit ADC with range 0-4095)
    if (audio.activeBuffer == 0) {
        audio.vReal0[sampleIndex] = sample; //Store the sample in the real part of the active buffer
    } else {
        audio.vReal1[sampleIndex] = sample; //Store the sample in the real part of the active buffer
    }
    sampleIndex++;
    if (sampleIndex >= N_samples) { //If we've collected enough samples for one buffer
        sampleIndex = 0; //Reset the sample index
        audio.activeBuffer = 1 - audio.activeBuffer; //Switch to the other buffer
        audio.dataReady = true; //Set the flag to indicate that data is ready for processing
    }
}

void AudioAnalyzer::begin() { //O(1)
    timer = timerBegin(0, 80, true); //Initialize timer 0 with a prescaler of 80 (1 tick = 1 microsecond)
    timerAttachInterrupt(timer, onTimer, true); //Attach the interrupt function to the timer
    timerAlarmWrite(timer, 100, true); //Set the timer to trigger every 10 milliseconds (100 microseconds)
    timerAlarmEnable(timer); //Enable the timer
}



void AudioAnalyzer::computeFFT() {
    //Using pointer to save time and avoid copying data between buffers
    for (int i = 0; i < N_samples; i++) {
    vImag0[i] = 0;
    }
    double *vReal = (activeBuffer == 0) ? vReal1 : vReal0; //Pointer to the real part of the active buffer
    double *vImag = vImag0; //Pointer to the imaginary part (same for both buffers since it's always 0)
    ArduinoFFT<double> FFT = ArduinoFFT<double>(vReal, vImag, N_samples, 10000); //Initialize the FFT object with the active buffer and sampling frequency of 10 kHz
    FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward); //Apply Hamming window to the data
    FFT.compute(FFTDirection::Forward); //Compute the FFT O(n log n)
    FFT.complexToMagnitude(); //Convert the complex FFT output to magnitude O(n)
}

void AudioAnalyzer::sendToTeleplot() {
    double *vReal = (activeBuffer == 0) ? vReal1 : vReal0;
    // 2. Loop through the primary half of the mirror (ignoring DC offset at 0)
    for (int i = 1; i < N_samples/2; i++) {
        // Teleplot format: >VariableName:Value
        Serial.printf(">Bin_%d:%f\n", i, vReal[i]);
    }
}

double AudioAnalyzer::getMagnitude(int bin) const {
    if (bin < 0 || bin >= N_samples) {
        return 0.0;
    }

    const double *vReal = (activeBuffer == 0) ? vReal1 : vReal0;
    return vReal[bin];
}

void AudioAnalyzer::stopTimer() {
    if(timer != NULL) {
        timerAlarmDisable(timer); //Disable the timer to stop data collection
    }
}

void AudioAnalyzer::startTimer() {
    if(timer != NULL) {
        timerAlarmEnable(timer); //Enable the timer to start data collection again
    }
}