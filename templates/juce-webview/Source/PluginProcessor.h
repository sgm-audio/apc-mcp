#pragma once
#include <JuceHeader.h>

#include <atomic>

class {{PLUGIN_CLASS_NAME}} : public juce::AudioProcessor {
public:
    {{PLUGIN_CLASS_NAME}}();
    ~{{PLUGIN_CLASS_NAME}}() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported(const BusesLayout &layouts) const override;
    void processBlock(juce::AudioBuffer<float> &, juce::MidiBuffer &) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor *createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "{{PLUGIN_DISPLAY_NAME}}"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String &) override {}

    void getStateInformation(juce::MemoryBlock &destData) override;
    void setStateInformation(const void *data, int sizeInBytes) override;

    // Parameter access for WebView bridge
    juce::AudioParameterFloat *getGainParam() const { return m_gain; }

    // Peak absolute sample value of the most recently processed output block,
    // for the WebView level meter. Written on the audio thread, read on the
    // message thread: a plain float there would be a data race, and a lock or
    // allocation would be illegal on the audio thread.
    float getOutputPeak() const { return m_outputPeak.load(std::memory_order_relaxed); }

private:
    juce::AudioParameterFloat *m_gain = nullptr;
    // Linear 20 ms ramp. Applying m_gain->get() directly makes every parameter
    // move a per-block step, which is audible as zipper noise on a gain control.
    juce::SmoothedValue<float, juce::ValueSmoothingTypes::Linear> m_gainSmoothed;
    std::atomic<float> m_outputPeak { 0.0f };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR({{PLUGIN_CLASS_NAME}})
};
