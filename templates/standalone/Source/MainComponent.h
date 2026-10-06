#pragma once
#include <JuceHeader.h>

#include <atomic>

//==============================================================================
// The app's content component, and its audio callback.
//
// juce::AudioAppComponent combines a juce::Component with a juce::AudioSource
// and owns a default juce::AudioDeviceManager.
//
// ⚠️ JUCE 9 API CHANGE — there is no start() and no stop() any more.
// setAudioChannels() both initialises the device and starts the callback, and
// its counterpart shutdownAudio() MUST be called from the destructor: the base
// class jassert()s if an audio source is still attached when it is destroyed
// ("If you hit this then your derived class must call shutdown audio in
// destructor!"). Older tutorials, books and example code that call
// start()/stop() will not compile against JUCE 9.
//
// Three methods are pure virtual and must be overridden: prepareToPlay(),
// getNextAudioBlock() and releaseResources().
class {{PLUGIN_ID}}MainComponent : public juce::AudioAppComponent
{
public:
    {{PLUGIN_ID}}MainComponent();
    ~{{PLUGIN_ID}}MainComponent() override;

    //==========================================================================
    // juce::AudioSource — these run on the AUDIO thread. No blocking, no
    // allocating, no locking, no GUI calls.
    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override;
    void getNextAudioBlock(const juce::AudioSourceChannelInfo &bufferToFill) override;
    void releaseResources() override;

    //==========================================================================
    // juce::Component — these run on the MESSAGE thread.
    void paint(juce::Graphics &g) override;
    void resized() override;

private:
    static constexpr double frequencyHz = 440.0;

    // `level` is written on the message thread (the slider's onValueChange) and
    // read on the audio thread (getNextAudioBlock). std::atomic makes that safe.
    // A plain float here is a data race, and the alternative — calling into the
    // slider from the audio callback — would block on the message thread and
    // glitch the audio.
    std::atomic<float> level { 0.0f };

    // Also written in prepareToPlay (audio thread) and read in getNextAudioBlock
    // (audio thread). Both are on the same thread, so no atomic is needed, but
    // it is initialised non-zero so a callback that somehow arrives before
    // prepareToPlay cannot divide by zero.
    double currentSampleRate = 44100.0;
    double phase = 0.0;

    juce::Slider levelSlider;
    juce::Label levelLabel;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR({{PLUGIN_ID}}MainComponent)
};
