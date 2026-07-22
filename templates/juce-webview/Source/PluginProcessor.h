#pragma once
#include <JuceHeader.h>

class {{PLUGIN_CLASS_NAME}} : public juce::AudioProcessor {
public:
    {{PLUGIN_CLASS_NAME}}();
    ~{{PLUGIN_CLASS_NAME}}() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock(juce::AudioBuffer<float> &, juce::MidiBuffer &) override;

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

private:
    juce::AudioParameterFloat *m_gain = nullptr;
    float m_lastGain = 1.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR({{PLUGIN_CLASS_NAME}})
};
