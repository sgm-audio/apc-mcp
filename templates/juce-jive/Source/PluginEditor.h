#pragma once
#include "PluginProcessor.h"

#include <jive_layouts/jive_layouts.h>

#include <memory>

class {{PLUGIN_ID}}Editor : public juce::AudioProcessorEditor {
public:
    explicit {{PLUGIN_ID}}Editor({{PLUGIN_CLASS_NAME}} &audioProcessor);
    ~{{PLUGIN_ID}}Editor() override;

    void resized() override;

private:
    void mountView(jive::GuiItem &root);
    void loadEmbeddedView();

    {{PLUGIN_CLASS_NAME}} &m_processor;

    // Declaration order controls teardown order (reverse):
    //   1. m_view detaches components & parameter attachments first
    //   2. m_interpreter stops observing ValueTree & files
    //   3. m_sourceRoot unregisters disk root (Debug builds)
    //   4. m_lookAndFeel detaches from *this last
    jive::LookAndFeel m_lookAndFeel { *this };
#if JUCE_DEBUG
    std::unique_ptr<jive::SourceRoot> m_sourceRoot;
#endif
    jive::Interpreter m_interpreter;
    std::unique_ptr<jive::GuiItem> m_view;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR({{PLUGIN_ID}}Editor)
};
