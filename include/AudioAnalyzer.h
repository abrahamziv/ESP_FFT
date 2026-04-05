#ifndef AUDIO_ANALYZER_H
#define AUDIO_ANALYZER_H

#include <Arduino.h>

#define N_samples 256 //Number of samples to collect for each FFT computation

class AudioAnalyzer {
    private:
        double vReal0[N_samples];
        double vReal1[N_samples];
        double vImag0[N_samples];

        volatile int activeBuffer;
        friend void IRAM_ATTR onTimer(); //Declare the timer interrupt function as a friend to access private members
    public:

        volatile bool dataReady;

        AudioAnalyzer();

        //Methods
        void begin();
        void computeFFT();
        void sendToTeleplot();
        double getMagnitude(int bin) const;
        void stopTimer();
        void startTimer();
};
#endif // AUDIO_ANALYZER_H
        