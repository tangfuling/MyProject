package com.niuma.gzh.modules.analysis.util;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

public final class AnalysisResultParser {
    private AnalysisResultParser() {
    }

    public static Parsed parse(String content) {
        if (content == null || content.isBlank()) {
            return Parsed.empty();
        }

        String stage = "";
        String rhythm = "";
        String riskHint = "";
        List<String> findings = new ArrayList<>();
        List<String> actions = new ArrayList<>();
        List<String> questions = new ArrayList<>();

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
                case STAGE -> {
                    if (stage.isBlank()) {
                        stage = line;
                    }
                }
                case FINDINGS -> findings.add(line);
                case ACTIONS -> actions.add(line);
                case RHYTHM -> {
                    if (rhythm.isBlank()) {
                        rhythm = line;
                    }
                }
                case RISK -> {
                    if (riskHint.isBlank()) {
                        riskHint = line;
                    }
                }
                case QUESTIONS -> {
                    String question = normalizeQuestion(line);
                    if (!question.isBlank()) {
                        questions.add(question);
                    }
                }
                case NONE -> {
                    if (stage.isBlank() && likelyStageSentence(line)) {
                        stage = line;
                    }
                    String question = normalizeQuestion(line);
                    if (!question.isBlank()) {
                        questions.add(question);
                    }
                    if (line.contains("风险") && riskHint.isBlank()) {
                        riskHint = line;
                    }
                }
            }
        }

        if (riskHint.isBlank()) {
            for (String rawLine : lines) {
                String line = normalizeLine(rawLine);
                if (line.contains("风险")) {
                    riskHint = line;
                    break;
                }
            }
        }

        findings = uniqueLimited(findings, 5);
        actions = uniqueLimited(actions, 5);
        questions = uniqueLimited(questions, 5);

        return new Parsed(stage, findings, actions, rhythm, riskHint, questions);
    }

    public static String toSummary(String content) {
        if (content == null || content.isBlank()) {
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
        if (line == null || line.isBlank()) {
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
        LinkedHashSet<String> unique = new LinkedHashSet<>();
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
        return List.copyOf(unique);
    }

    private enum Section {
        NONE,
        STAGE,
        FINDINGS,
        ACTIONS,
        RHYTHM,
        RISK,
        QUESTIONS
    }

    public record Parsed(
        String stage,
        List<String> findings,
        List<String> actionSuggestions,
        String rhythm,
        String riskHint,
        List<String> suggestedQuestions
    ) {
        public static Parsed empty() {
            return new Parsed("", List.of(), List.of(), "", "", List.of());
        }
    }
}
