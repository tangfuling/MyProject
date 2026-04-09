package com.niuma.gzh.modules.workspace.controller;

import com.niuma.gzh.common.base.ApiResponse;
import com.niuma.gzh.common.base.BaseController;
import com.niuma.gzh.modules.workspace.model.vo.WorkspaceOverviewVO;
import com.niuma.gzh.modules.workspace.service.WorkspaceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
@RequestMapping("/workspace")
public class WorkspaceController extends BaseController {
    private final WorkspaceService workspaceService;

    public WorkspaceController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @GetMapping("/overview")
    public ApiResponse<WorkspaceOverviewVO> overview(@RequestParam(value = "range", required = false) String range) {
        log.info("[tfling][workspace/overview] request range={}", range);
        WorkspaceOverviewVO overview = workspaceService.overview(range);
        Integer articleCount = overview.getHeader() == null ? null : overview.getHeader().getArticleCount();
        Integer totalRead = (overview.getDataPanel() == null || overview.getDataPanel().getMetrics() == null)
            ? null : overview.getDataPanel().getMetrics().getTotalRead();
        log.info("[tfling][workspace/overview] response range={}, articleCount={}, totalRead={}", overview.getRange(), articleCount, totalRead);
        return ApiResponse.success(overview);
    }
}
