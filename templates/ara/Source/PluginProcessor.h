#pragma once
#include <JuceHeader.h>

class {{PLUGIN_CLASS_NAME}} final : public juce::AudioProcessor,
                                    private juce::AudioProcessorARAExtension {
public:
    {{PLUGIN_CLASS_NAME}}();
    ~{{PLUGIN_CLASS_NAME}}() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported(const BusesLayout &layouts) const override;
    void processBlock(juce::AudioBuffer<float> &buffer, juce::MidiBuffer &midiMessages) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor *createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "{{PLUGIN_DISPLAY_NAME}}"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override;

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return "Default"; }
    void changeProgramName(int, const juce::String &) override {}

    void getStateInformation(juce::MemoryBlock &destData) override;
    void setStateInformation(const void *data, int sizeInBytes) override;

    juce::AudioProcessorARAExtension *getARAClientExtensions() override;

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR({{PLUGIN_CLASS_NAME}})
};
