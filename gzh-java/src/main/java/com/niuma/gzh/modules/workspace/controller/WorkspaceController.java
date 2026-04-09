package com.niuma.gzh.modules.workspace.controller;

import com.niuma.gzh.common.base.ApiResponse;
import com.niuma.gzh.common.base.BaseController;
import com.niuma.gzh.modules.workspace.model.vo.WorkspaceOverviewVO;
import com.niuma.gzh.modules.workspace.service.WorkspaceService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/workspace")
public class WorkspaceController extends BaseController {
    private final WorkspaceService workspaceService;

    public WorkspaceController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @GetMapping("/overview")
    public ApiResponse<WorkspaceOverviewVO> overview(@RequestParam(value = "range", required = false) String range) {
        return ApiResponse.success(workspaceService.overview(range));
    }
}
