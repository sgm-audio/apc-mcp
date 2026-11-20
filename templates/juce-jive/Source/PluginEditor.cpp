#include "PluginEditor.h"

#include <BinaryData.h>

#ifndef APC_JIVE_UI_DIR
#define APC_JIVE_UI_DIR ""
#endif

{{PLUGIN_ID}}Editor::{{PLUGIN_ID}}Editor({{PLUGIN_CLASS_NAME}} &audioProcessor)
    : juce::AudioProcessorEditor(&audioProcessor)
    , m_processor(audioProcessor)
{
    m_interpreter.autoAttachParameters(m_processor.getAPVTS());
    m_interpreter.onLoad = [this](jive::GuiItem &root) {
        mountView(root);
    };

#if JUCE_DEBUG
    const juce::File uiDir { APC_JIVE_UI_DIR };
    if (uiDir.getChildFile("MainView.xml").existsAsFile()) {
        m_sourceRoot = std::make_unique<jive::SourceRoot>(uiDir);
        m_view = m_interpreter.interpret(jive::SourceFile { "MainView.xml" });
    }
#endif

    if (m_view == nullptr)
        loadEmbeddedView();

    if (m_view != nullptr)
        mountView(*m_view);

    setResizable(true, true);
    setResizeLimits(320, 180, 960, 640);
    setSize(420, 240);
}

{{PLUGIN_ID}}Editor::~{{PLUGIN_ID}}Editor() {
    m_interpreter.onLoad = nullptr;
    m_view.reset();
}

void {{PLUGIN_ID}}Editor::resized() {
    if (m_view != nullptr) {
        if (auto *content = m_view->getComponent().get())
            content->setBounds(getLocalBounds());
    }
}

void {{PLUGIN_ID}}Editor::mountView(jive::GuiItem &root) {
    if (auto *content = root.getComponent().get()) {
        if (content->getParentComponent() != this)
            addAndMakeVisible(content);
        if (!getLocalBounds().isEmpty())
            content->setBounds(getLocalBounds());
    }
}

void {{PLUGIN_ID}}Editor::loadEmbeddedView() {
    auto tree = jive::parseXML(
        {{PLUGIN_ID}}_JiveData::MainView_xml,
        {{PLUGIN_ID}}_JiveData::MainView_xmlSize);

    const auto styleJson = juce::String::createStringFromData(
        {{PLUGIN_ID}}_JiveData::Styles_json,
        {{PLUGIN_ID}}_JiveData::Styles_jsonSize);
    const auto parsedStyle = jive::parseJSON(styleJson);

    if (tree.isValid() && parsedStyle.isObject())
        tree.setProperty(jive::ids::style(), parsedStyle, nullptr);

    if (tree.isValid())
        m_view = m_interpreter.interpret(tree);
}
