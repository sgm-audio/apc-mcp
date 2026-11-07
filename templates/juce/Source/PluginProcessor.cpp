#include "PluginProcessor.h"

#include <algorithm>

{{PLUGIN_CLASS_NAME}}::{{PLUGIN_CLASS_NAME}}()
    : AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}

{{PLUGIN_CLASS_NAME}}::~{{PLUGIN_CLASS_NAME}}() = default;

void {{PLUGIN_CLASS_NAME}}::prepareToPlay(double sampleRate, int samplesPerBlock) {
    juce::ignoreUnused(sampleRate, samplesPerBlock);
}

void {{PLUGIN_CLASS_NAME}}::releaseResources() {}

bool {{PLUGIN_CLASS_NAME}}::isBusesLayoutSupported(const BusesLayout &layouts) const {
    const auto &mainOut = layouts.getMainOutputChannelSet();
    if (mainOut != juce::AudioChannelSet::mono()
        && mainOut != juce::AudioChannelSet::stereo())
        return false;

    return mainOut == layouts.getMainInputChannelSet();
}

void {{PLUGIN_CLASS_NAME}}::processBlock(juce::AudioBuffer<float> &buffer, juce::MidiBuffer &) {
    juce::ScopedNoDenormals noDenormals;
    const auto totalNumInputChannels = getTotalNumInputChannels();
    const auto totalNumOutputChannels = getTotalNumOutputChannels();

    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear(i, 0, buffer.getNumSamples());

    const auto channelsToProcess = std::min(totalNumInputChannels, totalNumOutputChannels);
    for (int channel = 0; channel < channelsToProcess; ++channel) {
        const auto *channelData = buffer.getReadPointer(channel);
        auto *outData = buffer.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            outData[sample] = channelData[sample]; // passthrough
    }
}

juce::AudioProcessorEditor *{{PLUGIN_CLASS_NAME}}::createEditor() {
    return new juce::GenericAudioProcessorEditor(*this);
}

void {{PLUGIN_CLASS_NAME}}::getStateInformation(juce::MemoryBlock &destData) {
    juce::ignoreUnused(destData);
}

void {{PLUGIN_CLASS_NAME}}::setStateInformation(const void *data, int sizeInBytes) {
    juce::ignoreUnused(data, sizeInBytes);
}

juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() {
    return new {{PLUGIN_CLASS_NAME}}();
}
