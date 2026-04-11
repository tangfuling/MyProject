package com.niuma.gzh.modules.analysis.util;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

public final class AnalysisResultParser {
    private AnalysisResultParser() {
    }

    public static Parsed parse(String content) {
        if (isBlank(content)) {
            return Parsed.empty();
        }

        String signalOverview = "";
        String stage = "";
        String rhythm = "";
        String riskHint = "";
        List<String> findings = new ArrayList<String>();
        List<String> actions = new ArrayList<String>();
        List<String> questions = new ArrayList<String>();

        Section section = Section.NONE;
        String[] lines = content.split("\\R");
        for (String rawLine : lines) {
            String line = normalizeLine(rawLine);
            if (line.isEmpty()) {
                continue;
            }

            Section heading = detectSection(line);
            if (heading != Section.NONE) {
                section = heading;
                continue;
            }

            switch (section) {
                case SIGNAL:
                    if (isBlank(signalOverview)) {
                        signalOverview = line;
                    }
                    break;
                case STAGE:
                    if (isBlank(stage)) {
                        stage = line;
                    }
                    break;
                case FINDINGS:
                    findings.add(line);
                    break;
                case ACTIONS:
                    actions.add(line);
                    break;
                case RHYTHM:
                    if (isBlank(rhythm)) {
                        rhythm = line;
                    }
                    break;
                case RISK:
                    if (isBlank(riskHint)) {
                        riskHint = line;
                    }
                    break;
                case QUESTIONS:
                    String question = normalizeQuestion(line);
                    if (!isBlank(question)) {
                        questions.add(question);
                    }
                    break;
                case NONE:
                    if (isBlank(signalOverview) && likelySignalSentence(line)) {
                        signalOverview = line;
                    }
                    if (isBlank(stage) && likelyStageSentence(line)) {
                        stage = line;
                    }
                    String guessedQuestion = normalizeQuestion(line);
                    if (!isBlank(guessedQuestion)) {
                        questions.add(guessedQuestion);
                    }
                    if (line.contains("风险") && isBlank(riskHint)) {
                        riskHint = line;
                    }
                    break;
                default:
                    break;
            }
        }

        if (isBlank(riskHint)) {
            for (String rawLine : lines) {
                String line = normalizeLine(rawLine);
                if (line.contains("风险")) {
                    riskHint = line;
                    break;
                }
            }
        }

        if (isBlank(signalOverview) && !findings.isEmpty()) {
            signalOverview = findings.get(0);
        }

        findings = uniqueLimited(findings, 5);
        actions = uniqueLimited(actions, 5);
        questions = uniqueLimited(questions, 6);

        return new Parsed(signalOverview, stage, findings, actions, rhythm, riskHint, questions);
    }

    public static String toSummary(String content) {
        if (isBlank(content)) {
            return "暂无分析摘要";
        }
        String text = content.replace('\n', ' ').replace('\r', ' ').replaceAll("\\s+", " ").trim();
        if (text.length() <= 130) {
            return text;
        }
        return text.substring(0, 130) + "...";
    }

    private static boolean likelyStageSentence(String line) {
        String lower = line.toLowerCase(Locale.ROOT);
        if (line.length() < 8 || line.length() > 120) {
            return false;
        }
        return lower.contains("阶段")
            || line.contains("目前")
            || line.contains("当前")
            || line.contains("账号")
            || line.contains("处于");
    }

    private static boolean likelySignalSentence(String line) {
        if (line.length() < 8 || line.length() > 120) {
            return false;
        }
        return line.contains("信号")
            || line.contains("概览")
            || line.contains("推荐率")
            || line.contains("趋势");
    }

    private static String normalizeLine(String raw) {
        if (raw == null) {
            return "";
        }
        String text = raw.trim();
        if (text.isEmpty()) {
            return "";
        }
        text = text.replaceFirst("^#{1,6}\\s*", "");
        text = text.replaceFirst("^[\\-•*]+\\s*", "");
        text = text.replaceFirst("^\\d+[\\.、\\)]\\s*", "");
        text = text.replaceFirst("^\\(\\d+\\)\\s*", "");
        text = text.replaceFirst("^[（(][一二三四五六七八九十\\d]+[）)]\\s*", "");
        text = text.replace("**", "").replace("__", "").trim();
        return text;
    }

    private static Section detectSection(String line) {
        String normalized = line.replaceAll("[：:：\\s]", "");
        if (normalized.contains("信号概览") || normalized.contains("关键信号")) {
            return Section.SIGNAL;
        }
        if (normalized.contains("风险提示") || normalized.equals("风险")) {
            return Section.RISK;
        }
        if (normalized.contains("推荐问题") || normalized.contains("问题引导")) {
            return Section.QUESTIONS;
        }
        if (normalized.contains("核心发现")) {
            return Section.FINDINGS;
        }
        if (normalized.contains("可执行建议")
            || normalized.contains("行动建议")
            || normalized.contains("本周建议")
            || normalized.equals("建议")
            || normalized.contains("三条建议")
            || normalized.contains("3条建议")) {
            return Section.ACTIONS;
        }
        if (normalized.contains("节奏感") || normalized.contains("节奏")) {
            return Section.RHYTHM;
        }
        if (normalized.contains("你现在在什么阶段")
            || normalized.contains("现在在什么阶段")
            || normalized.contains("阶段判断")
            || normalized.equals("阶段")) {
            return Section.STAGE;
        }
        return Section.NONE;
    }

    private static String normalizeQuestion(String line) {
        if (isBlank(line)) {
            return "";
        }
        String text = line.trim();
        if (!(text.contains("?") || text.contains("？"))) {
            return "";
        }
        text = text.replace("?", "？");
        int idx = text.indexOf('？');
        if (idx <= 0) {
            return "";
        }
        text = text.substring(0, idx + 1).trim();
        text = text.replaceFirst("^[\\-•*\\d\\.、\\)\\s]+", "");
        if (text.length() < 4 || text.length() > 36) {
            return "";
        }
        return text;
    }

    private static List<String> uniqueLimited(List<String> values, int maxSize) {
        LinkedHashSet<String> unique = new LinkedHashSet<String>();
        for (String value : values) {
            if (value == null) {
                continue;
            }
            String normalized = value.trim();
            if (normalized.isEmpty()) {
                continue;
            }
            unique.add(normalized);
            if (unique.size() >= maxSize) {
                break;
            }
        }
        return Collections.unmodifiableList(new ArrayList<String>(unique));
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private enum Section {
        NONE,
        SIGNAL,
        STAGE,
        FINDINGS,
        ACTIONS,
        RHYTHM,
        RISK,
        QUESTIONS
    }

    public static class Parsed {
        private final String signalOverview;
        private final String stage;
        private final List<String> findings;
        private final List<String> actionSuggestions;
        private final String rhythm;
        private final String riskHint;
        private final List<String> suggestedQuestions;

        public Parsed(String signalOverview,
                      String stage,
                      List<String> findings,
                      List<String> actionSuggestions,
                      String rhythm,
                      String riskHint,
                      List<String> suggestedQuestions) {
            this.signalOverview = signalOverview;
            this.stage = stage;
            this.findings = findings;
            this.actionSuggestions = actionSuggestions;
            this.rhythm = rhythm;
            this.riskHint = riskHint;
            this.suggestedQuestions = suggestedQuestions;
        }

        public static Parsed empty() {
            return new Parsed("", "", Collections.<String>emptyList(), Collections.<String>emptyList(), "", "", Collections.<String>emptyList());
        }

        public String signalOverview() {
            return signalOverview;
        }

        public String stage() {
            return stage;
        }

        public List<String> findings() {
            return findings;
        }

        public List<String> actionSuggestions() {
            return actionSuggestions;
        }

        public String rhythm() {
            return rhythm;
        }

        public String riskHint() {
            return riskHint;
        }

        public List<String> suggestedQuestions() {
            return suggestedQuestions;
        }

        public String getSignalOverview() {
            return signalOverview;
        }

        public String getStage() {
            return stage;
        }

        public List<String> getFindings() {
            return findings;
        }

        public List<String> getActionSuggestions() {
            return actionSuggestions;
        }

        public String getRhythm() {
            return rhythm;
        }

        public String getRiskHint() {
            return riskHint;
        }

        public List<String> getSuggestedQuestions() {
            return suggestedQuestions;
        }
    }
}
