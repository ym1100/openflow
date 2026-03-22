import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "@/components/Header";

const mockSetWorkflowMetadata = vi.fn();
const mockSaveToFile = vi.fn();
const mockLoadWorkflow = vi.fn();
const mockDuplicateWorkflowToPath = vi.fn();
const mockUseWorkflowStore = vi.fn();

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector?: (state: unknown) => unknown) => {
    if (selector) return mockUseWorkflowStore(selector);
    return mockUseWorkflowStore((s: unknown) => s);
  },
}));

vi.mock("@/components/NewProjectModal", () => ({
  NewProjectModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="new-project-modal">New Project Modal</div> : null,
}));

vi.mock("@/components/ProjectSetupModal", () => ({
  ProjectSetupModal: ({ isOpen, mode }: { isOpen: boolean; mode: string }) =>
    isOpen ? <div data-testid="project-setup-modal" data-mode={mode}>Project Setup Modal</div> : null,
}));

vi.mock("@/components/GlobalImageHistory", () => ({
  GlobalImageHistory: () => null,
}));

const createDefaultState = (overrides = {}) => ({
  workflowName: "",
  workflowId: "",
  saveDirectoryPath: "",
  hasUnsavedChanges: false,
  lastSavedAt: null,
  isSaving: false,
  setWorkflowMetadata: mockSetWorkflowMetadata,
  saveToFile: mockSaveToFile,
  loadWorkflow: mockLoadWorkflow,
  duplicateWorkflowToPath: mockDuplicateWorkflowToPath,
  shortcutsDialogOpen: false,
  setShortcutsDialogOpen: vi.fn(),
  setShowQuickstart: vi.fn(),
  flowyAgentOpen: false,
  flowyHistoryRailOpen: false,
  toggleFlowyHistoryRail: vi.fn(),
  setFlowyAgentOpen: vi.fn(),
  setFlowyHistoryRailOpen: vi.fn(),
  ...overrides,
});

describe("Header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkflowStore.mockImplementation((selector) => selector(createDefaultState()));
  });

  describe("Basic Rendering", () => {
    it("should render the menu icon in the Openflows menu button", () => {
      render(<Header />);
      const menu = screen.getByRole("button", { name: "Openflows menu" });
      expect(menu).toBeInTheDocument();
      const icon = menu.querySelector("svg");
      expect(icon).toBeInTheDocument();
    });

    it("should not render Made by Willie link", () => {
      render(<Header />);
      expect(screen.queryByText("Made by Willie")).not.toBeInTheDocument();
    });

    it("should not render Discord link", () => {
      render(<Header />);
      expect(screen.queryByTitle("Support")).not.toBeInTheDocument();
    });
  });

  describe("Unconfigured Project State", () => {
    it("should show Untitled Project when no project name is set", () => {
      render(<Header />);
      expect(screen.getByText("Untitled Project")).toBeInTheDocument();
    });

    it("should show Not saved status when project is not configured", () => {
      render(<Header />);
      expect(screen.getByText("Not saved")).toBeInTheDocument();
    });
  });

  describe("Configured Project State", () => {
    beforeEach(() => {
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({ workflowName: "My Project", workflowId: "project-123", saveDirectoryPath: "/path/to/project" }))
      );
    });

    it("should show project name when configured", () => {
      render(<Header />);
      expect(screen.getByText("My Project")).toBeInTheDocument();
    });

    it("should show Not saved when no lastSavedAt timestamp", () => {
      render(<Header />);
      expect(screen.getByText("Not saved")).toBeInTheDocument();
    });
  });

  describe("Project Dropdown", () => {
    beforeEach(() => {
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({ workflowName: "My Project", workflowId: "project-123", saveDirectoryPath: "/path/to/project" }))
      );
    });

    it("should open dropdown when logo menu is clicked", () => {
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Openflows menu" }));
      expect(screen.getByText("Project settings")).toBeInTheDocument();
      expect(screen.getByText("Duplicate project")).toBeInTheDocument();
    });

    it("should open ProjectSetupModal in settings mode when Project settings clicked", () => {
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Openflows menu" }));
      fireEvent.click(screen.getByText("Project settings"));
      const modal = screen.getByTestId("project-setup-modal");
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute("data-mode", "settings");
    });

    it("should open ProjectSetupModal in duplicate mode when Duplicate project clicked", () => {
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Openflows menu" }));
      fireEvent.click(screen.getByText("Duplicate project"));
      const modal = screen.getByTestId("project-setup-modal");
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveAttribute("data-mode", "duplicate");
    });

    it("should show Open project in dropdown", () => {
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Openflows menu" }));
      expect(screen.getByText("Open project")).toBeInTheDocument();
    });
  });

  describe("Unconfigured Project Dropdown", () => {
    it("should show New project instead of Project settings when unconfigured", () => {
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Openflows menu" }));
      expect(screen.getByText("New project")).toBeInTheDocument();
      expect(screen.queryByText("Project settings")).not.toBeInTheDocument();
      expect(screen.queryByText("Duplicate project")).not.toBeInTheDocument();
    });

    it("should open NewProjectModal when New project clicked", () => {
      render(<Header />);
      fireEvent.click(screen.getByRole("button", { name: "Openflows menu" }));
      fireEvent.click(screen.getByText("New project"));
      expect(screen.getByTestId("new-project-modal")).toBeInTheDocument();
    });
  });

  describe("Save State Display", () => {
    it("should show Saving... when isSaving is true", () => {
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({ workflowName: "My Project", workflowId: "project-123", saveDirectoryPath: "/path/to/project", isSaving: true }))
      );
      render(<Header />);
      expect(screen.getByText("Saving...")).toBeInTheDocument();
    });

    it("should show formatted save time when lastSavedAt is set", () => {
      const timestamp = new Date("2024-01-15T14:30:00").getTime();
      mockUseWorkflowStore.mockImplementation((selector) =>
        selector(createDefaultState({ workflowName: "My Project", workflowId: "project-123", saveDirectoryPath: "/path/to/project", lastSavedAt: timestamp }))
      );
      render(<Header />);
      expect(screen.getByText(/Saved/)).toBeInTheDocument();
    });
  });

  describe("File Loading", () => {
    it("should have hidden file input for loading workflows", () => {
      const { container } = render(<Header />);
      const fileInput = container.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
      expect(fileInput).toHaveAttribute("accept", ".json");
      expect(fileInput).toHaveClass("hidden");
    });
  });

});
