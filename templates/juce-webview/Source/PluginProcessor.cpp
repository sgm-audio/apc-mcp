#include "PluginProcessor.h"
#include "WebViewEditor.h"

{{PLUGIN_CLASS_NAME}}::{{PLUGIN_CLASS_NAME}}()
    : AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
    m_gain = new juce::AudioParameterFloat("gain", "Gain",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.75f);
    addParameter(m_gain);
}

{{PLUGIN_CLASS_NAME}}::~{{PLUGIN_CLASS_NAME}}() = default;

void {{PLUGIN_CLASS_NAME}}::prepareToPlay(double sampleRate, int samplesPerBlock) {
    juce::ignoreUnused(sampleRate, samplesPerBlock);
}

void {{PLUGIN_CLASS_NAME}}::releaseResources() {}

void {{PLUGIN_CLASS_NAME}}::processBlock(juce::AudioBuffer<float> &buffer, juce::MidiBuffer &) {
    juce::ScopedNoDenormals noDenormals;
    auto totalNumInputChannels = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();

    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear(i, 0, buffer.getNumSamples());

    float gain = m_gain->get();
    m_lastGain = gain;

    for (int channel = 0; channel < totalNumInputChannels; ++channel) {
        auto *channelData = buffer.getReadPointer(channel);
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
    state.setProperty("gain", (double)m_gain->get(), nullptr);

    // XmlDocument::storeXmlAsString does not exist in JUCE 9; copyXmlToBinary is
    // the supported helper for serialising state into a MemoryBlock.
    if (auto xml = state.createXml())
        copyXmlToBinary(*xml, destData);
}

void {{PLUGIN_CLASS_NAME}}::setStateInformation(const void *data, int sizeInBytes) {
    if (auto xml = getXmlFromBinary(data, sizeInBytes)) {
        auto state = juce::ValueTree::fromXml(*xml);

        if (state.isValid())
            *m_gain = (float)state.getProperty("gain", 0.75);
    }
}
