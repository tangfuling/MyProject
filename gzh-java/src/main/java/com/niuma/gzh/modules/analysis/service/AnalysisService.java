package com.niuma.gzh.modules.analysis.service;

import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.modules.analysis.model.dto.GenerateAnalysisDTO;
import com.niuma.gzh.modules.analysis.model.vo.AnalysisEstimateVO;
import com.niuma.gzh.modules.analysis.model.vo.AnalysisReportVO;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

public interface AnalysisService {
    SseEmitter generate(GenerateAnalysisDTO dto);

    AnalysisEstimateVO estimate(String range);

    PageResult<AnalysisReportVO> reports(long page, long size);

    AnalysisReportVO reportDetail(Long id);
}
