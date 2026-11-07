#include "PluginProcessor.h"
#include "WebViewEditor.h"

#include <algorithm>

{{PLUGIN_CLASS_NAME}}::{{PLUGIN_CLASS_NAME}}()
    : AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
    m_gain = new juce::AudioParameterFloat(juce::ParameterID { "gain", 1 }, "Gain",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.75f);
    addParameter(m_gain);
}

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

    const float gain = m_gain->get();
    const auto channelsToProcess = std::min(totalNumInputChannels, totalNumOutputChannels);

    for (int channel = 0; channel < channelsToProcess; ++channel) {
        const auto *channelData = buffer.getReadPointer(channel);
        auto *outData = buffer.getWritePointer(channel);
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            outData[sample] = channelData[sample] * gain;
    }
}

juce::AudioProcessorEditor *{{PLUGIN_CLASS_NAME}}::createEditor() {
    return new WebViewEditor(*this);
}

void {{PLUGIN_CLASS_NAME}}::getStateInformation(juce::MemoryBlock &destData) {
    auto state = juce::ValueTree("state");
    state.setProperty("gain", static_cast<double>(m_gain->get()), nullptr);

    // XmlDocument::storeXmlAsString does not exist in JUCE 9; copyXmlToBinary is
    // the supported helper for serialising state into a MemoryBlock.
    if (auto xml = state.createXml())
        copyXmlToBinary(*xml, destData);
}

void {{PLUGIN_CLASS_NAME}}::setStateInformation(const void *data, int sizeInBytes) {
    if (auto xml = getXmlFromBinary(data, sizeInBytes)) {
        auto state = juce::ValueTree::fromXml(*xml);

        if (state.isValid())
            *m_gain = static_cast<float>(state.getProperty("gain", 0.75));
    }
}

juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() {
    return new {{PLUGIN_CLASS_NAME}}();
}
