#include "PluginProcessor.h"
#include "WebViewEditor.h"

#include <algorithm>
#include <cmath>

{{PLUGIN_CLASS_NAME}}::{{PLUGIN_CLASS_NAME}}()
    : AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
    m_gain = new juce::AudioParameterFloat(juce::ParameterID { "gain", 1 }, "Gain",
        juce::NormalisableRange<float>(0.0f, 1.0f), 0.75f);
    addParameter(m_gain);
}

{{PLUGIN_CLASS_NAME}}::~{{PLUGIN_CLASS_NAME}}() = default;

void {{PLUGIN_CLASS_NAME}}::prepareToPlay(double sampleRate, int samplesPerBlock) {
    juce::ignoreUnused(samplesPerBlock);
    // reset() takes a ramp length in seconds, so this follows the host's sample
    // rate instead of assuming 44.1 kHz.
    m_gainSmoothed.reset(sampleRate, 0.02);
    m_gainSmoothed.setCurrentAndTargetValue(m_gain->get());
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
    if (channelsToProcess <= 0)
        return;

    // AudioBuffer already owns the pointer array this returns, so fetching it is
    // allocation-free; re-reading it inside the sample loop would not be.
    auto *const *channels = buffer.getArrayOfWritePointers();
    const int numSamples = buffer.getNumSamples();

    // Sample-outer, channel-inner on purpose. The smoother advances once per
    // sample; a channel-outer loop would end block N with the ramp advanced N
    // times and give the channels different gains within the same block.
    m_gainSmoothed.setTargetValue(m_gain->get());
    for (int sample = 0; sample < numSamples; ++sample) {
        const float gain = m_gainSmoothed.getNextValue();
        for (int channel = 0; channel < channelsToProcess; ++channel)
            channels[channel][sample] *= gain;
    }
}

juce::AudioProcessorEditor *{{PLUGIN_CLASS_NAME}}::createEditor() {
    return new WebViewEditor(*this);
}

void {{PLUGIN_CLASS_NAME}}::getStateInformation(juce::MemoryBlock &destData) {
    auto state = juce::ValueTree("state");
    state.setProperty("gain", static_cast<double>(m_gain->get()), nullptr);

    // copyXmlToBinary is the supported helper for serialising an XmlElement into
    // a MemoryBlock. XmlDocument has no serialising helper of its own — it is a
    // parser — so do not go looking for one.
    if (auto xml = state.createXml())
        copyXmlToBinary(*xml, destData);
}

void {{PLUGIN_CLASS_NAME}}::setStateInformation(const void *data, int sizeInBytes) {
    if (auto xml = getXmlFromBinary(data, sizeInBytes)) {
        auto state = juce::ValueTree::fromXml(*xml);

        if (state.isValid()) {
            const auto raw = static_cast<float>(state.getProperty("gain", 0.75));
            *m_gain = std::isfinite(raw) ? juce::jlimit(0.0f, 1.0f, raw) : 0.75f;
        }
    }
}

juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() {
    return new {{PLUGIN_CLASS_NAME}}();
}
