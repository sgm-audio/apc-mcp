#pragma once
#include <JuceHeader.h>
#include "PluginProcessor.h"

class {{PLUGIN_CLASS_NAME}}Editor final : public juce::AudioProcessorEditor,
                                          private juce::AudioProcessorEditorARAExtension {
public:
    explicit {{PLUGIN_CLASS_NAME}}Editor({{PLUGIN_CLASS_NAME}} &ownerProcessor);
    void paint(juce::Graphics &graphics) override;

    juce::AudioProcessorEditorARAExtension *getARAClientExtensions() override;

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR({{PLUGIN_CLASS_NAME}}Editor)
};
