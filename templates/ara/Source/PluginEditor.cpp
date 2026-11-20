#include "PluginEditor.h"

{{PLUGIN_CLASS_NAME}}Editor::{{PLUGIN_CLASS_NAME}}Editor({{PLUGIN_CLASS_NAME}} &processor)
    : juce::AudioProcessorEditor(&processor),
      juce::AudioProcessorEditorARAExtension(&processor) {
    setResizable(true, false);
    setSize(480, 180);
}

void {{PLUGIN_CLASS_NAME}}Editor::paint(juce::Graphics &graphics) {
    graphics.fillAll(juce::Colours::black);
    graphics.setColour(juce::Colours::white);
    graphics.drawText(isARAEditorView() ? "ARA document view connected" : "ARA effect ready",
                      getLocalBounds(),
                      juce::Justification::centred,
                      true);
}

juce::AudioProcessorEditorARAExtension *{{PLUGIN_CLASS_NAME}}Editor::getARAClientExtensions() {
    return this;
}
