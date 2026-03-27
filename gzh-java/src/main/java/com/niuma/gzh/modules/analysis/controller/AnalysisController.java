package com.niuma.gzh.modules.analysis.controller;

import com.niuma.gzh.common.base.ApiResponse;
import com.niuma.gzh.common.base.BaseController;
import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.common.validation.PageParam;
import com.niuma.gzh.modules.analysis.model.dto.GenerateAnalysisDTO;
import com.niuma.gzh.modules.analysis.model.vo.AnalysisReportVO;
import com.niuma.gzh.modules.analysis.service.AnalysisService;
import jakarta.validation.Valid;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Validated
@RestController
@RequestMapping("/analysis")
public class AnalysisController extends BaseController {
    private final AnalysisService analysisService;

    public AnalysisController(AnalysisService analysisService) {
        this.analysisService = analysisService;
    }

    @PostMapping("/generate")
    public SseEmitter generate(@RequestBody @Valid GenerateAnalysisDTO dto) {
        return analysisService.generate(dto);
    }

    @GetMapping("/reports")
    public ApiResponse<PageResult<AnalysisReportVO>> reports(@Valid PageParam pageParam) {
        return ApiResponse.success(analysisService.reports(pageParam.page(), pageParam.size()));
    }

    @GetMapping("/reports/{id}")
    public ApiResponse<AnalysisReportVO> report(@PathVariable Long id) {
        return ApiResponse.success(analysisService.reportDetail(id));
    }
}
