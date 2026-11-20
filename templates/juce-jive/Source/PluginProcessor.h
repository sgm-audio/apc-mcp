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
    bool acceptsMidi() const override { return {{PLUGIN_ACCEPTS_MIDI_CXX}}; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String &) override {}

    void getStateInformation(juce::MemoryBlock &destData) override;
    void setStateInformation(const void *data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState &getAPVTS() noexcept { return m_apvts; }
    const juce::AudioProcessorValueTreeState &getAPVTS() const noexcept { return m_apvts; }

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();

    juce::AudioProcessorValueTreeState m_apvts;
    std::atomic<float> *m_gainParam = nullptr;
    juce::SmoothedValue<float, juce::ValueSmoothingTypes::Linear> m_gainSmoothed;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR({{PLUGIN_CLASS_NAME}})
};
